console.log("Crazy globe booting…");

// ---------- Data sources ----------
const COUNTRIES_GEOJSON_URL =
  "https://raw.githubusercontent.com/datasets/geo-countries/main/data/countries.geojson";

// Natural Earth populated places (simple). ~4.7MB from the Natural Earth repo mirror.
// If this ever feels heavy, we can swap to a smaller cities dataset later.
const POPULATED_PLACES_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson";

// World Bank indicator: GDP per capita (current US$)
const WB_INDICATOR = "NY.GDP.PCAP.CD";
const WB_URL =
  `https://api.worldbank.org/v2/country/all/indicator/${WB_INDICATOR}?format=json&per_page=20000`;

// ---------- DOM ----------
const elLoading = document.getElementById("loading");
const elPanel = document.getElementById("panel");
const elTooltip = document.getElementById("tooltip");

// ---------- Globe ----------
const globe = Globe()(document.getElementById("globe"))
  .globeImageUrl("//unpkg.com/three-globe/example/img/earth-night.jpg")
  .bumpImageUrl("//unpkg.com/three-globe/example/img/earth-topology.png")
  .backgroundColor("#000")
  .atmosphereColor("#65a7ff")
  .atmosphereAltitude(0.22);

// Controls
globe.controls().autoRotate = true;
globe.controls().autoRotateSpeed = 0.35;
globe.controls().enablePan = false; // feels more "earth explorer"
globe.controls().minDistance = 160;
globe.controls().maxDistance = 620;

// ---------- State ----------
let countriesFC = null;
let citiesFC = null;
let wbLatestByIso3 = new Map(); // ISO3 -> { value, year }
let selectedCountry = null;

// For polygon visual state
const BASE_ALT = 0.01;
const HOVER_ALT = 0.05;
const SELECT_ALT = 0.12;

// ---------- Utilities ----------
function fmtMoney(v) {
  if (v == null || Number.isNaN(v)) return "N/A";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(v);
}

function fmtPop(v) {
  if (v == null || Number.isNaN(v)) return "N/A";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(v);
}

function safeIso3(feature) {
  // geo-countries uses property: "ISO3166-1-Alpha-3"
  return feature?.properties?.["ISO3166-1-Alpha-3"] ?? null;
}

function safeName(feature) {
  // geo-countries uses property: "name"
  return feature?.properties?.name ?? "Unknown";
}

function wbForIso3(iso3) {
  return wbLatestByIso3.get(iso3) ?? null;
}

function showTooltip(x, y, html) {
  elTooltip.innerHTML = html;
  elTooltip.style.left = `${x}px`;
  elTooltip.style.top = `${y}px`;
  elTooltip.style.opacity = "1";
}

function hideTooltip() {
  elTooltip.style.opacity = "0";
}

function setPanelHTML(html) {
  elPanel.innerHTML = `<div class="panel-inner">${html}</div>`;
}

function centroidLatLng(feature) {
  // turf.centroid is usually okay; for weird polygons this is still stable enough for camera POV.
  const c = turf.centroid(feature);
  const [lng, lat] = c.geometry.coordinates;
  return { lat, lng };
}

function quantizeColor(value, breaks, colors) {
  if (value == null || Number.isNaN(value)) return "rgba(180,180,180,0.12)";
  for (let i = 0; i < breaks.length; i++) {
    if (value < breaks[i]) return colors[i];
  }
  return colors[colors.length - 1];
}

// ---------- Loaders ----------
async function loadWorldBankLatest() {
  const res = await fetch(WB_URL);
  if (!res.ok) throw new Error("World Bank API failed");
  const json = await res.json();

  // WB returns: [ metadata, data[] ]
  const rows = json?.[1] ?? [];

  // Keep latest non-null value per ISO3.
  // Country is rows[i].country.id (ISO2-ish sometimes) BUT "countryiso3code" exists in WB indicator responses.
  // We'll rely on countryiso3code when present.
  const tmp = new Map(); // iso3 -> { year, value }

  for (const r of rows) {
    const iso3 = r?.countryiso3code;
    const year = Number(r?.date);
    const value = r?.value;

    if (!iso3 || !year || value == null) continue;

    const prev = tmp.get(iso3);
    if (!prev || year > prev.year) {
      tmp.set(iso3, { year, value: Number(value) });
    }
  }

  wbLatestByIso3 = tmp;
}

async function loadAll() {
  const [countries, cities] = await Promise.all([
    fetch(COUNTRIES_GEOJSON_URL).then(r => r.json()),
    fetch(POPULATED_PLACES_URL).then(r => r.json()),
    loadWorldBankLatest()
  ]);

  countriesFC = countries;
  citiesFC = cities;

  buildViz();
  elLoading.style.display = "none";
}

// ---------- Build Viz ----------
function buildViz() {
  // Build a choropleth palette from GDP per capita (log-ish breaks).
  // These are "nice" buckets that make the globe pop.
  const breaks = [1500, 5000, 15000, 35000, 65000];
  const colors = [
    "rgba(120, 40, 40, 0.35)",
    "rgba(180, 70, 50, 0.35)",
    "rgba(230, 140, 70, 0.35)",
    "rgba(255, 210, 120, 0.35)",
    "rgba(160, 230, 190, 0.35)",
    "rgba(90, 210, 240, 0.35)"
  ];

  // Initial panel
  setPanelHTML(`
    <div class="panel-title">Click a country</div>
    <div class="panel-hint">
      Countries are colored by <strong>GDP per capita (current US$)</strong> from the World Bank.
      Click a country to zoom and load its <strong>top 5 cities</strong>.
    </div>
  `);

  globe
    .polygonsData(countriesFC.features)
    .polygonStrokeColor(() => "rgba(255,255,255,0.18)")
    .polygonSideColor(() => "rgba(0,0,0,0.10)")
    .polygonCapColor((feat) => {
      const iso3 = safeIso3(feat);
      const wb = iso3 ? wbForIso3(iso3) : null;
      const v = wb?.value ?? null;
      return quantizeColor(v, breaks, colors);
    })
    .polygonAltitude((feat) => {
      if (selectedCountry && feat === selectedCountry) return SELECT_ALT;
      return BASE_ALT;
    })
    .polygonsTransitionDuration(550)

    // Hover tooltip only (no altitude pop)
    .onPolygonHover((feat, event) => {
      if (!feat) return hideTooltip();
      const iso3 = safeIso3(feat);
      const name = safeName(feat);
      const wb = iso3 ? wbForIso3(iso3) : null;
      const gdp = wb?.value ?? null;
      const year = wb?.year ?? null;

      showTooltip(
        event.clientX,
        event.clientY,
        `<strong>${name}</strong><br/>
         <span style="opacity:.85">GDP/cap:</span> ${gdp == null ? "N/A" : "$" + fmtMoney(gdp)}
         ${year ? `<span style="opacity:.7">(${year})</span>` : ""}`
      );
    })

    // Click = select, zoom, show panel, show cities
    .onPolygonClick((feat, event) => {
      if (!feat) return;

      selectedCountry = feat;

      // stop auto-rotate when user starts exploring
      globe.controls().autoRotate = false;

      const name = safeName(feat);
      const iso3 = safeIso3(feat);

      const wb = iso3 ? wbForIso3(iso3) : null;

      // Zoom to centroid
      const { lat, lng } = centroidLatLng(feat);
      globe.pointOfView({ lat, lng, altitude: 1.15 }, 1400);

      // Force re-evaluate altitudes for selection
      globe.polygonAltitude((f) => (f === selectedCountry ? SELECT_ALT : BASE_ALT));

      // Find top 5 cities for this country (Natural Earth field is usually adm0_a3 in populated places)
      const cityFeatures = (citiesFC?.features ?? [])
        .filter(c => (c?.properties?.adm0_a3 === iso3))
        .map(c => {
          const [clng, clat] = c.geometry.coordinates;
          return {
            name: c.properties.name,
            adm0: c.properties.adm0_a3,
            pop: Number(c.properties.pop_max ?? c.properties.pop_min ?? NaN),
            lat: clat,
            lng: clng
          };
        })
        .filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng))
        .sort((a, b) => (b.pop || 0) - (a.pop || 0))
        .slice(0, 5);

      // Render cities as points
      globe
        .pointsData(cityFeatures)
        .pointLat(d => d.lat)
        .pointLng(d => d.lng)
        .pointAltitude(0.02)
        .pointRadius(d => {
          // slightly scale by population so it looks "crazy"
          if (!Number.isFinite(d.pop)) return 0.35;
          const s = Math.max(0.35, Math.min(1.2, Math.log10(d.pop) - 4.2));
          return s;
        })
        .pointColor(() => "rgba(255,170,60,0.95)")
        .pointLabel(d =>
          `<div style="padding:6px 8px">
             <div style="font-weight:700">${d.name}</div>
             <div style="opacity:.8;font-size:12px">Pop (est): ${fmtPop(d.pop)}</div>
           </div>`
        )
        .onPointClick((city) => {
          globe.pointOfView({ lat: city.lat, lng: city.lng, altitude: 0.55 }, 1200);

          // flash a quick tooltip at click location
          showTooltip(
            event.clientX,
            event.clientY,
            `<strong>${city.name}</strong><br/>
             <span style="opacity:.85">Pop (est):</span> ${fmtPop(city.pop)}`
          );

          // also update panel to show "selected city"
          const basePanel = countryPanelHTML(name, iso3, wb, cityFeatures);
          setPanelHTML(basePanel.replace(
            "%%CITY%%",
            `<div class="small">Selected city: <strong>${city.name}</strong></div>`
          ));
        });

      // Panel
      setPanelHTML(countryPanelHTML(name, iso3, wb, cityFeatures));
    });
}

function countryPanelHTML(name, iso3, wb, cities) {
  const gdpLine = wb?.value == null
    ? `GDP per capita: <strong>N/A</strong>`
    : `GDP per capita: <strong>$${fmtMoney(wb.value)}</strong> <span style="opacity:.7">(${wb.year})</span>`;

  const cityBlock = (cities?.length)
    ? `
      <div class="card">
        <div class="panel-title">Top cities</div>
        <div class="panel-hint">Click a city to zoom.</div>
        <div class="city-list">
          ${cities.map((c, idx) => `
            <button class="city-btn" data-idx="${idx}">
              <span class="city-name">${c.name}</span>
              <span class="city-pop">${fmtPop(c.pop)}</span>
            </button>
          `).join("")}
        </div>
      </div>
    `
    : `
      <div class="card">
        <div class="panel-title">Top cities</div>
        <div class="panel-hint">
          No city matches found for ISO3: <strong>${iso3 ?? "?"}</strong>.
          (This is fixable by switching the city dataset or adding a code mapping.)
        </div>
      </div>
    `;

  // Wire city buttons after render (delegated)
  setTimeout(() => {
    document.querySelectorAll(".city-btn").forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.getAttribute("data-idx"));
        const c = cities[idx];
        if (!c) return;
        globe.controls().autoRotate = false;
        globe.pointOfView({ lat: c.lat, lng: c.lng, altitude: 0.55 }, 1200);
      };
    });
  }, 0);

  return `
    <div class="panel-title">Country</div>

    <div class="card">
      <h2>${name}</h2>
      <p class="meta">ISO3: <strong>${iso3 ?? "N/A"}</strong></p>
      <div class="big">${wb?.value == null ? "N/A" : "$" + fmtMoney(wb.value)}</div>
      <div class="small">${gdpLine}</div>
      %%CITY%%
    </div>

    ${cityBlock}
  `;
}

// ---------- Go ----------
loadAll().catch(err => {
  console.error(err);
  elLoading.innerText = "Failed to load data. Check console.";
});

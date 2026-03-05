console.log("World map loaded");

const width = 900;
const height = 600;

let active = null;

const svg = d3.select("#map")
  .append("svg")
  .attr("width", width)
  .attr("height", height);

const g = svg.append("g");

const projection = d3.geoNaturalEarth1();

const path = d3.geoPath()
  .projection(projection);

Promise.all([
  d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json")
]).then(([world]) => {

  const countries = topojson.feature(world, world.objects.countries);

  projection.fitSize([width, height], countries);

  g.selectAll("path")
    .data(countries.features)
    .enter()
    .append("path")
    .attr("d", path)
    .attr("fill", "#d3d3d3")
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 0.8)
    .attr("cursor", "pointer")

    .on("click", function(event, d) {

      if (active === this) {

        active = null;

        g.transition()
          .duration(750)
          .attr("transform", "");

        g.selectAll("path")
          .transition()
          .duration(300)
          .style("opacity", 1);

        d3.select("#info-panel").html("");

        return;
      }

      active = this;

      g.selectAll("path")
        .transition()
        .duration(300)
        .style("opacity", 0.2);

      d3.select(this)
        .transition()
        .duration(300)
        .style("opacity", 1)
        .attr("stroke", "#000")
        .attr("stroke-width", 2);

      const [[x0, y0], [x1, y1]] = path.bounds(d);

      const dx = x1 - x0;
      const dy = y1 - y0;

      const x = (x0 + x1) / 2;
      const y = (y0 + y1) / 2;

      const scale = Math.max(
        1,
        Math.min(8, 0.9 / Math.max(dx / width, dy / height))
      );

      const translate = [
        width / 2 - scale * x,
        height / 2 - scale * y
      ];

      g.transition()
        .duration(750)
        .attr("transform", `translate(${translate})scale(${scale})`);

      d3.select("#info-panel").html(`
        <div class="card">
          <h2>Country Selected</h2>
          <p>Country ID: ${d.id}</p>
          <p>This is where country data will go.</p>
        </div>
      `);

      setTimeout(() => {
        document.querySelector(".card")?.classList.add("visible");
      }, 50);

    });

});

const CONFIG = {
  geoUrl: "../MesoIndia/data/india-states-simplified.geojson",
  routeUrl: "./data/trains.json"
};

const state = {
  routes: [],
  filtered: [],
  selectedId: null
};

const dom = {
  map: d3.select("#route-map"),
  search: document.getElementById("search-input"),
  originFilter: document.getElementById("origin-filter"),
  destinationFilter: document.getElementById("destination-filter"),
  reset: document.getElementById("reset-filters"),
  routeList: document.getElementById("route-list"),
  resultLabel: document.getElementById("result-label"),
  detailTitle: document.getElementById("detail-title"),
  detailSubtitle: document.getElementById("detail-subtitle"),
  detailGrid: document.getElementById("detail-grid"),
  statRoutes: document.getElementById("stat-routes"),
  statStates: document.getElementById("stat-states"),
  statLongest: document.getElementById("stat-longest")
};

const width = 960;
const height = 760;
const projection = d3.geoMercator();
const path = d3.geoPath(projection);

const svg = dom.map;
const g = svg.append("g");
const stateLayer = g.append("g").attr("class", "state-layer");
const routeLayer = g.append("g").attr("class", "route-layer");
const nodeLayer = g.append("g").attr("class", "node-layer");
const labelLayer = g.append("g").attr("class", "label-layer");

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseDurationToMinutes(text) {
  const hours = Number((text.match(/(\d+)h/) || [0, 0])[1]);
  const minutes = Number((text.match(/(\d+)m/) || [0, 0])[1]);
  return (hours * 60) + minutes;
}

function enrichRoute(route) {
  const interstate = route.originState !== route.destinationState;
  return {
    ...route,
    id: slugify(`${route.trainNumber}-${route.origin}-${route.destination}`),
    interstate,
    durationMinutes: parseDurationToMinutes(route.journeyTime),
    searchBlob: [
      route.trainNumber,
      route.origin,
      route.destination,
      route.originState,
      route.destinationState
    ].join(" ").toLowerCase()
  };
}

function buildCurve(startPoint, endPoint) {
  const [x1, y1] = startPoint;
  const [x2, y2] = endPoint;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const norm = Math.max(Math.hypot(dx, dy), 1);
  const curvature = Math.min(60, Math.max(24, norm * 0.12));
  const cx = mx - (dy / norm) * curvature;
  const cy = my + (dx / norm) * curvature;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

function routePoint(route, key) {
  const coords = key === "origin" ? route.originCoords : route.destinationCoords;
  return projection([coords[1], coords[0]]);
}

function setSummaryStats(routes) {
  const states = new Set();
  routes.forEach((route) => {
    states.add(route.originState);
    states.add(route.destinationState);
  });
  const longest = routes.reduce((best, route) => (route.distanceKm > (best?.distanceKm || 0) ? route : best), null);

  dom.statRoutes.textContent = routes.length;
  dom.statStates.textContent = states.size;
  dom.statLongest.textContent = longest ? `${longest.distanceKm} km` : "-";
}

function populateFilters(routes) {
  const states = [...new Set(routes.flatMap((route) => [route.originState, route.destinationState]))].sort();
  states.forEach((stateName) => {
    const optionOrigin = document.createElement("option");
    optionOrigin.value = stateName;
    optionOrigin.textContent = stateName;
    dom.originFilter.append(optionOrigin);

    const optionDestination = document.createElement("option");
    optionDestination.value = stateName;
    optionDestination.textContent = stateName;
    dom.destinationFilter.append(optionDestination);
  });
}

function currentFilters() {
  return {
    search: dom.search.value.trim().toLowerCase(),
    originState: dom.originFilter.value,
    destinationState: dom.destinationFilter.value
  };
}

function applyFilters() {
  const filters = currentFilters();
  state.filtered = state.routes.filter((route) => {
    if (filters.search && !route.searchBlob.includes(filters.search)) {
      return false;
    }
    if (filters.originState && route.originState !== filters.originState) {
      return false;
    }
    if (filters.destinationState && route.destinationState !== filters.destinationState) {
      return false;
    }
    return true;
  });

  if (!state.filtered.some((route) => route.id === state.selectedId)) {
    state.selectedId = state.filtered[0]?.id || null;
  }

  renderRouteList();
  renderRouteLines();
  renderDetails();

  dom.resultLabel.textContent = state.filtered.length === state.routes.length
    ? "Showing all routes."
    : `Showing ${state.filtered.length} filtered route${state.filtered.length === 1 ? "" : "s"}.`;
}

function renderRouteList() {
  dom.routeList.innerHTML = "";

  if (!state.filtered.length) {
    dom.routeList.innerHTML = `<div class="empty-state">No routes match the current filters.</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  state.filtered.forEach((route) => {
    const article = document.createElement("article");
    article.className = `route-item${route.id === state.selectedId ? " active" : ""}`;
    article.tabIndex = 0;
    article.setAttribute("role", "listitem");
    article.innerHTML = `
      <div class="route-topline">
        <div>
          <div class="route-name">${route.origin} to ${route.destination}</div>
          <div class="route-meta">${route.trainNumber}</div>
        </div>
        <span class="route-badge ${route.interstate ? "interstate" : "intrastate"}">
          ${route.interstate ? "Inter-state" : "Intra-state"}
        </span>
      </div>
      <p class="route-meta">${route.distanceKm} km · ${route.journeyTime} · ${route.originState} to ${route.destinationState}</p>
    `;

    article.addEventListener("click", () => selectRoute(route.id));
    article.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectRoute(route.id);
      }
    });

    fragment.append(article);
  });

  dom.routeList.append(fragment);
}

function renderDetails() {
  const route = state.routes.find((entry) => entry.id === state.selectedId);

  if (!route) {
    dom.detailTitle.textContent = "Select a route";
    dom.detailSubtitle.textContent = "Click a line on the map or a route in the list to inspect it here.";
    dom.detailGrid.innerHTML = "";
    return;
  }

  dom.detailTitle.textContent = `${route.origin} to ${route.destination}`;
  dom.detailSubtitle.textContent = `${route.trainNumber} · ${route.interstate ? "Inter-state service" : "Intra-state service"}`;

  const details = [
    ["Train Number", route.trainNumber],
    ["Origin", route.origin],
    ["Destination", route.destination],
    ["Origin State", route.originState],
    ["Destination State", route.destinationState],
    ["Distance", `${route.distanceKm} km`],
    ["Journey Time", route.journeyTime],
    ["Map Type", route.interstate ? "Inter-state connection" : "Intra-state connection"]
  ];

  dom.detailGrid.innerHTML = details.map(([label, value]) => `
    <div>
      <dt>${label}</dt>
      <dd>${value}</dd>
    </div>
  `).join("");
}

function renderRouteLines() {
  const visibleIds = new Set(state.filtered.map((route) => route.id));

  const lines = routeLayer.selectAll("path")
    .data(state.routes, (route) => route.id)
    .join("path")
    .attr("class", (route) => [
      "route-map-line",
      route.interstate ? "interstate" : "intrastate",
      visibleIds.has(route.id) ? "" : "dimmed",
      route.id === state.selectedId ? "active" : ""
    ].filter(Boolean).join(" "))
    .attr("d", (route) => buildCurve(routePoint(route, "origin"), routePoint(route, "destination")))
    .on("click", (_, route) => selectRoute(route.id));

  lines.selectAll("title")
    .data((route) => [route])
    .join("title")
    .text((route) => `${route.trainNumber}: ${route.origin} to ${route.destination}`);

  routeLayer.selectAll("path")
    .filter((route) => route.id === state.selectedId)
    .raise();
}

function renderStations() {
  const stationMap = new Map();

  state.routes.forEach((route) => {
    [
      { name: route.origin, coords: route.originCoords },
      { name: route.destination, coords: route.destinationCoords }
    ].forEach((station) => {
      if (!stationMap.has(station.name)) {
        stationMap.set(station.name, station);
      }
    });
  });

  const stations = [...stationMap.values()].map((station) => ({
    ...station,
    point: projection([station.coords[1], station.coords[0]])
  }));

  nodeLayer.selectAll("circle")
    .data(stations, (station) => station.name)
    .join("circle")
    .attr("class", "station-node")
    .attr("r", 3.8)
    .attr("cx", (station) => station.point[0])
    .attr("cy", (station) => station.point[1]);

  labelLayer.selectAll("text")
    .data(stations, (station) => station.name)
    .join("text")
    .attr("class", "station-label")
    .attr("x", (station) => station.point[0] + 6)
    .attr("y", (station) => station.point[1] - 6)
    .text((station) => station.name);
}

function selectRoute(routeId) {
  state.selectedId = routeId;
  renderRouteList();
  renderRouteLines();
  renderDetails();
}

function wireEvents() {
  [dom.search, dom.originFilter, dom.destinationFilter].forEach((element) => {
    element.addEventListener("input", applyFilters);
    element.addEventListener("change", applyFilters);
  });

  dom.reset.addEventListener("click", () => {
    dom.search.value = "";
    dom.originFilter.value = "";
    dom.destinationFilter.value = "";
    applyFilters();
  });
}

async function init() {
  const [indiaGeo, routes] = await Promise.all([
    fetch(CONFIG.geoUrl).then((response) => response.json()),
    fetch(CONFIG.routeUrl).then((response) => response.json())
  ]);

  state.routes = routes.map(enrichRoute);
  state.filtered = [...state.routes];
  state.selectedId = state.routes[0]?.id || null;

  projection.fitExtent([[24, 24], [width - 24, height - 24]], indiaGeo);

  stateLayer.selectAll("path")
    .data(indiaGeo.features)
    .join("path")
    .attr("class", "state-path")
    .attr("d", path);

  populateFilters(state.routes);
  setSummaryStats(state.routes);
  renderStations();
  renderRouteList();
  renderRouteLines();
  renderDetails();
  wireEvents();
}

init().catch((error) => {
  console.error(error);
  dom.resultLabel.textContent = "Failed to load map data.";
  dom.detailTitle.textContent = "Load error";
  dom.detailSubtitle.textContent = "Check the browser console and make sure the folder is served over HTTP.";
});

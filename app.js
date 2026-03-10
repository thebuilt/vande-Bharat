const CONFIG = {
  geoUrl: "./data/india-states-simplified.geojson",
  railwayUrl: "./data/railway_network.geojson",
  routeUrl: "./data/trains.json",
  width: 960,
  height: 760
};

const state = {
  routes: [],
  filtered: [],
  selectedId: null,
  indiaGeo: null,
  railwayGeo: null
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
  statLongest: document.getElementById("stat-longest"),
  mapError: document.getElementById("map-error")
};

function showError(message) {
  dom.mapError.hidden = false;
  dom.mapError.textContent = message;
}

function clearError() {
  dom.mapError.hidden = true;
  dom.mapError.textContent = "";
}

async function fetchJson(url, required = true) {
  const response = await fetch(url);
  if (!response.ok) {
    const message = `Failed to load ${url} (${response.status}).`;
    if (required) {
      throw new Error(message);
    }
    showError(`${message} The map is rendering without that layer.`);
    return null;
  }
  return response.json();
}

const projection = d3.geoMercator();
const path = d3.geoPath(projection);

const svg = dom.map;
const root = svg.append("g");
const stateLayer = root.append("g");
const networkLayer = root.append("g");
const routeLayer = root.append("g");
const stationLayer = root.append("g");
const labelLayer = root.append("g");

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
  const [lat1, lon1] = startPoint;
  const [lat2, lon2] = endPoint;
  const mx = (lat1 + lat2) / 2;
  const my = (lon1 + lon2) / 2;
  const dx = lat2 - lat1;
  const dy = lon2 - lon1;
  const norm = Math.max(Math.hypot(dx, dy), 1);
  const curvature = Math.min(2.4, Math.max(0.7, norm * 0.16));
  const cx = mx - (dy / norm) * curvature;
  const cy = my + (dx / norm) * curvature;
  return [startPoint, [cx, cy], endPoint];
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
  const line = d3.line()
    .x((point) => projection([point[1], point[0]])[0])
    .y((point) => projection([point[1], point[0]])[1])
    .curve(d3.curveCatmullRom.alpha(0.5));

  const routes = routeLayer.selectAll("path")
    .data(state.routes, (route) => route.id);

  routes.join("path")
    .attr("class", (route) => [
      "route-map-line",
      route.interstate ? "interstate" : "intrastate",
      visibleIds.has(route.id) ? "" : "dimmed",
      route.id === state.selectedId ? "active" : ""
    ].filter(Boolean).join(" "))
    .attr("d", (route) => line(buildCurve(route.originCoords, route.destinationCoords)))
    .on("click", (_, route) => selectRoute(route.id));

  routeLayer.selectAll("path")
    .filter((route) => route.id === state.selectedId)
    .raise();

  renderStations();
}

function renderStations() {
  const selectedRoute = state.routes.find((route) => route.id === state.selectedId);
  if (!selectedRoute) {
    stationLayer.selectAll("*").remove();
    labelLayer.selectAll("*").remove();
    return;
  }

  const stations = [
    { name: selectedRoute.origin, coords: selectedRoute.originCoords, anchor: "start" },
    { name: selectedRoute.destination, coords: selectedRoute.destinationCoords, anchor: "end" }
  ].map((station) => ({
    ...station,
    point: projection([station.coords[1], station.coords[0]])
  }));

  stationLayer.selectAll("circle")
    .data(stations, (station) => station.name)
    .join("circle")
    .attr("class", "station-node")
    .attr("r", 5)
    .attr("cx", (station) => station.point[0])
    .attr("cy", (station) => station.point[1]);

  labelLayer.selectAll("text")
    .data(stations, (station) => station.name)
    .join("text")
    .attr("class", "selected-station-label")
    .attr("x", (station) => station.point[0] + (station.anchor === "start" ? 8 : -8))
    .attr("y", (station) => station.point[1] - 8)
    .attr("text-anchor", (station) => station.anchor === "start" ? "start" : "end")
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
  clearError();
  const [indiaGeo, railwayGeo, routes] = await Promise.all([
    fetchJson(CONFIG.geoUrl, true),
    fetchJson(CONFIG.railwayUrl, false),
    fetchJson(CONFIG.routeUrl, true)
  ]);

  state.indiaGeo = indiaGeo;
  state.railwayGeo = railwayGeo;
  state.routes = routes.map(enrichRoute);
  state.filtered = [...state.routes];
  state.selectedId = state.routes[0]?.id || null;

  projection.fitExtent([[24, 24], [CONFIG.width - 24, CONFIG.height - 24]], indiaGeo);

  stateLayer.selectAll("path")
    .data(indiaGeo.features)
    .join("path")
    .attr("class", "state-path")
    .attr("d", path);

  if (railwayGeo?.features?.length) {
    networkLayer.selectAll("path")
      .data(railwayGeo.features)
      .join("path")
      .attr("class", "rail-network-path")
      .attr("d", path);
  }

  populateFilters(state.routes);
  setSummaryStats(state.routes);
  renderRouteList();
  renderRouteLines();
  renderDetails();
  wireEvents();
}

init().catch((error) => {
  console.error(error);
  showError(error.message || "Map failed to load.");
  dom.resultLabel.textContent = "Failed to load map data.";
  dom.detailTitle.textContent = "Load error";
  dom.detailSubtitle.textContent = "The page loaded, but one or more map files did not.";
});

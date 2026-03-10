const CONFIG = {
  routeUrl: "./data/trains.json",
  indiaBounds: [[6.5, 68], [37.6, 97.5]]
};

const state = {
  routes: [],
  filtered: [],
  selectedId: null,
  map: null,
  routeLayers: new Map(),
  stationLayer: null
};

const dom = {
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
  state.routeLayers.forEach((layer) => layer.remove());
  state.routeLayers.clear();

  const visibleIds = new Set(state.filtered.map((route) => route.id));
  state.routes.forEach((route) => {
    const latlngs = buildCurve(route.originCoords, route.destinationCoords);
    const isVisible = visibleIds.has(route.id);
    const isActive = route.id === state.selectedId;
    const color = route.interstate ? "#c65d2e" : "#1a7f6b";

    const layer = L.polyline(latlngs, {
      color,
      weight: isActive ? 6 : 3,
      opacity: isVisible ? (isActive ? 1 : 0.78) : 0.08,
      lineCap: "round"
    })
      .addTo(state.map)
      .bindPopup(`
        <div class="map-popup">
          <strong>${route.origin} to ${route.destination}</strong>
          <span>${route.trainNumber} · ${route.distanceKm} km · ${route.journeyTime}</span>
        </div>
      `);

    layer.on("click", () => selectRoute(route.id, true));
    state.routeLayers.set(route.id, layer);
  });

  renderStations(visibleIds);
}

function renderStations(visibleIds) {
  if (state.stationLayer) {
    state.stationLayer.remove();
  }

  const stationMap = new Map();

  state.filtered.forEach((route) => {
    [
      { name: route.origin, coords: route.originCoords },
      { name: route.destination, coords: route.destinationCoords }
    ].forEach((station) => {
      if (!stationMap.has(station.name)) {
        stationMap.set(station.name, station);
      }
    });
  });

  state.stationLayer = L.layerGroup();

  [...stationMap.values()].forEach((station) => {
    L.circleMarker(station.coords, {
      radius: 4,
      color: "#364239",
      weight: 1,
      fillColor: "#fffaf3",
      fillOpacity: 1
    })
      .bindTooltip(station.name, {
        direction: "top",
        offset: [0, -4],
        className: "station-tooltip"
      })
      .addTo(state.stationLayer);
  });

  state.stationLayer.addTo(state.map);
}

function focusMap(route) {
  if (!route) return;
  const bounds = L.latLngBounds([route.originCoords, route.destinationCoords]);
  state.map.fitBounds(bounds.pad(0.8), { animate: true, duration: 0.6 });
}

function selectRoute(routeId, shouldFocusMap = false) {
  state.selectedId = routeId;
  renderRouteList();
  renderRouteLines();
  renderDetails();

  if (shouldFocusMap) {
    const route = state.routes.find((entry) => entry.id === routeId);
    focusMap(route);
  }
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
  const routes = await fetch(CONFIG.routeUrl).then((response) => response.json());

  state.routes = routes.map(enrichRoute);
  state.filtered = [...state.routes];
  state.selectedId = state.routes[0]?.id || null;
  state.map = L.map("route-map", {
    zoomControl: true,
    minZoom: 4,
    maxZoom: 8,
    scrollWheelZoom: true
  });
  state.map.fitBounds(CONFIG.indiaBounds);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(state.map);

  populateFilters(state.routes);
  setSummaryStats(state.routes);
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

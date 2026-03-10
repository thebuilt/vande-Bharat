var CONFIG = {
  renderUrl: "./data/render-data.json"
};

var SVG_NS = "http://www.w3.org/2000/svg";

var state = {
  routes: [],
  filtered: [],
  selectedId: null,
  renderData: null,
  mapMode: "all"
};

var dom = {
  map: document.getElementById("route-map"),
  search: document.getElementById("search-input"),
  originFilter: document.getElementById("origin-filter"),
  destinationFilter: document.getElementById("destination-filter"),
  mapMode: document.getElementById("map-mode"),
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

var layers = {
  states: null,
  railways: null,
  routes: null,
  stations: null,
  labels: null
};

function svgEl(tag, attrs) {
  var node = document.createElementNS(SVG_NS, tag);
  var key;
  for (key in attrs) {
    if (Object.prototype.hasOwnProperty.call(attrs, key)) {
      node.setAttribute(key, attrs[key]);
    }
  }
  return node;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function showError(message) {
  dom.mapError.hidden = false;
  dom.mapError.textContent = message;
}

function clearError() {
  dom.mapError.hidden = true;
  dom.mapError.textContent = "";
}

function fetchJson(url) {
  return fetch(url).then(function (response) {
    if (!response.ok) {
      throw new Error("Failed to load " + url + " (" + response.status + ").");
    }
    return response.json();
  });
}

function enrichRoute(route) {
  route.id = slugify(route.trainNumber + "-" + route.origin + "-" + route.destination);
  route.searchBlob = [
    route.trainNumber,
    route.origin,
    route.destination,
    route.originState,
    route.destinationState
  ].join(" ").toLowerCase();
  return route;
}

function formatDistance(distanceKm) {
  return typeof distanceKm === "number" ? (distanceKm + " km") : "Distance unavailable";
}

function setSummaryStats(routes) {
  var statesSeen = {};
  var longest = null;
  var i;

  for (i = 0; i < routes.length; i += 1) {
    statesSeen[routes[i].originState] = true;
    statesSeen[routes[i].destinationState] = true;
    if (typeof routes[i].distanceKm === "number" && (!longest || routes[i].distanceKm > longest.distanceKm)) {
      longest = routes[i];
    }
  }

  dom.statRoutes.textContent = String(routes.length);
  dom.statStates.textContent = String(Object.keys(statesSeen).length);
  dom.statLongest.textContent = longest ? (longest.distanceKm + " km") : "-";
}

function populateFilters(routes) {
  var stateNames = {};
  var names;
  var i;

  for (i = 0; i < routes.length; i += 1) {
    stateNames[routes[i].originState] = true;
    stateNames[routes[i].destinationState] = true;
  }

  names = Object.keys(stateNames).sort();

  names.forEach(function (name) {
    var optionOrigin = document.createElement("option");
    optionOrigin.value = name;
    optionOrigin.textContent = name;
    dom.originFilter.appendChild(optionOrigin);

    var optionDestination = document.createElement("option");
    optionDestination.value = name;
    optionDestination.textContent = name;
    dom.destinationFilter.appendChild(optionDestination);
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
  var filters = currentFilters();

  state.filtered = state.routes.filter(function (route) {
    if (filters.search && route.searchBlob.indexOf(filters.search) === -1) {
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

  if (!state.filtered.some(function (route) { return route.id === state.selectedId; })) {
    state.selectedId = state.filtered.length ? state.filtered[0].id : null;
  }

  dom.resultLabel.textContent = state.filtered.length === state.routes.length
    ? "Showing all routes."
    : "Showing " + state.filtered.length + " filtered route" + (state.filtered.length === 1 ? "." : "s.");

  renderRouteList();
  renderRouteLines();
  renderDetails();
}

function renderRouteList() {
  dom.routeList.innerHTML = "";

  if (!state.filtered.length) {
    dom.routeList.innerHTML = '<div class="empty-state">No routes match the current filters.</div>';
    return;
  }

  state.filtered.forEach(function (route) {
    var article = document.createElement("article");
    article.className = "route-item" + (route.id === state.selectedId ? " active" : "");
    article.tabIndex = 0;
    article.setAttribute("role", "listitem");
    article.innerHTML =
      '<div class="route-topline">' +
        "<div>" +
          '<div class="route-name">' + route.origin + " to " + route.destination + "</div>" +
          '<div class="route-meta">' + route.trainNumber + "</div>" +
        "</div>" +
        '<span class="route-badge ' + (route.interstate ? "interstate" : "intrastate") + '">' +
          (route.interstate ? "Inter-state" : "Intra-state") +
        "</span>" +
      "</div>" +
      '<p class="route-meta">' + formatDistance(route.distanceKm) + " · " + route.journeyTime + " · " + route.originState + " to " + route.destinationState + "</p>";

    article.addEventListener("click", function () {
      selectRoute(route.id);
    });
    article.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectRoute(route.id);
      }
    });

    dom.routeList.appendChild(article);
  });
}

function renderDetails() {
  var route = state.routes.find(function (entry) {
    return entry.id === state.selectedId;
  });
  var details;

  if (!route) {
    dom.detailTitle.textContent = "Select a route";
    dom.detailSubtitle.textContent = "Click a line on the map or a route in the list to inspect it here.";
    dom.detailGrid.innerHTML = "";
    return;
  }

  dom.detailTitle.textContent = route.origin + " to " + route.destination;
  dom.detailSubtitle.textContent = route.trainNumber + " · " + (route.interstate ? "Inter-state service" : "Intra-state service");

  details = [
    ["Train Number", route.trainNumber],
    ["Origin", route.origin],
    ["Destination", route.destination],
    ["Origin State", route.originState],
    ["Destination State", route.destinationState],
    ["Distance", formatDistance(route.distanceKm)],
    ["Journey Time", route.journeyTime],
    ["Days", route.daysOfService || "-"],
    ["Departure", route.departureTime || "-"],
    ["Arrival", route.arrivalTime || "-"],
    ["Map Type", route.interstate ? "Inter-state connection" : "Intra-state connection"]
  ];

  dom.detailGrid.innerHTML = details.map(function (pair) {
    return "<div><dt>" + pair[0] + "</dt><dd>" + pair[1] + "</dd></div>";
  }).join("");
}

function clearLayer(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function renderRouteLines() {
  var visibleIds = {};
  var selectedRoute = null;

  state.filtered.forEach(function (route) {
    visibleIds[route.id] = true;
  });

  clearLayer(layers.routes);
  clearLayer(layers.stations);
  clearLayer(layers.labels);

  state.routes.forEach(function (route) {
    var shouldShow = state.mapMode === "all"
      ? !!visibleIds[route.id]
      : route.id === state.selectedId;
    var path = svgEl("path", {
      d: "M " + route.projected.origin[0] + " " + route.projected.origin[1] +
        " L " + route.projected.destination[0] + " " + route.projected.destination[1],
      class: "route-map-line " +
        (route.interstate ? "interstate " : "intrastate ") +
        (shouldShow ? "" : "dimmed ") +
        (route.id === state.selectedId ? "active" : "")
    });

    path.addEventListener("click", function () {
      selectRoute(route.id);
    });

    layers.routes.appendChild(path);

    if (route.id === state.selectedId) {
      selectedRoute = route;
    }
  });

  if (!selectedRoute) {
    return;
  }

  [
    { name: selectedRoute.origin, point: selectedRoute.projected.origin, anchor: "start" },
    { name: selectedRoute.destination, point: selectedRoute.projected.destination, anchor: "end" }
  ].forEach(function (station) {
    var circle = svgEl("circle", {
      class: "station-node",
      cx: station.point[0],
      cy: station.point[1],
      r: 5
    });
    var label = svgEl("text", {
      class: "selected-station-label",
      x: station.point[0] + (station.anchor === "start" ? 8 : -8),
      y: station.point[1] - 8,
      "text-anchor": station.anchor === "start" ? "start" : "end"
    });

    label.textContent = station.name;
    layers.stations.appendChild(circle);
    layers.labels.appendChild(label);
  });
}

function selectRoute(routeId) {
  state.selectedId = routeId;
  renderRouteList();
  renderRouteLines();
  renderDetails();
}

function wireEvents() {
  [dom.search, dom.originFilter, dom.destinationFilter].forEach(function (element) {
    element.addEventListener("input", applyFilters);
    element.addEventListener("change", applyFilters);
  });

  dom.mapMode.addEventListener("change", function () {
    state.mapMode = dom.mapMode.value;
    renderRouteLines();
  });

  dom.reset.addEventListener("click", function () {
    dom.search.value = "";
    dom.originFilter.value = "";
    dom.destinationFilter.value = "";
    dom.mapMode.value = "all";
    state.mapMode = "all";
    applyFilters();
  });
}

function initSvg(renderData) {
  dom.map.setAttribute("viewBox", "0 0 " + renderData.width + " " + renderData.height);

  layers.states = svgEl("g", {});
  layers.railways = svgEl("g", {});
  layers.routes = svgEl("g", {});
  layers.stations = svgEl("g", {});
  layers.labels = svgEl("g", {});

  dom.map.appendChild(layers.states);
  dom.map.appendChild(layers.railways);
  dom.map.appendChild(layers.routes);
  dom.map.appendChild(layers.stations);
  dom.map.appendChild(layers.labels);

  renderData.states.forEach(function (entry) {
    layers.states.appendChild(svgEl("path", {
      d: entry.path,
      class: "state-path"
    }));
  });

  renderData.railways.forEach(function (pathData) {
    layers.railways.appendChild(svgEl("path", {
      d: pathData,
      class: "rail-network-path"
    }));
  });
}

function init() {
  clearError();
  fetchJson(CONFIG.renderUrl).then(function (renderData) {
    state.renderData = renderData;
    state.routes = renderData.routes.map(enrichRoute);
    state.filtered = state.routes.slice();
    state.selectedId = state.routes.length ? state.routes[0].id : null;

    initSvg(renderData);
    populateFilters(state.routes);
    setSummaryStats(state.routes);
    renderRouteList();
    renderRouteLines();
    renderDetails();
    wireEvents();
  }).catch(function (error) {
    console.error(error);
    showError(error.message || "Map failed to load.");
    dom.resultLabel.textContent = "Failed to load map data.";
    dom.detailTitle.textContent = "Load error";
    dom.detailSubtitle.textContent = "The page loaded, but the map dataset did not.";
  });
}

init();

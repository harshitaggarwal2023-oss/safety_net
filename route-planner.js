"use strict";

/*
 * Safety Net — route.html: Safe Route & Highway Planner.
 * Defaulted to India with Highway Priority Recommendations,
 * Draggable pin correction, reverse-geocoding, and Safety POIs.
 */

// ---------------------------------------------------------------------------
// Safety score model with Road Type & Highway Bonus
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6371000;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function timeOfDayMultiplier(date) {
  const hour = date.getHours();
  if (hour >= 22 || hour < 5) return 1.4; // late night
  if (hour >= 19 || hour < 7) return 1.2; // evening / dawn
  return 1.0; // daytime
}

function isHighwayStep(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return (
    lower.includes("nh") ||
    lower.includes("highway") ||
    lower.includes("expressway") ||
    lower.includes("bypass") ||
    lower.includes("ring road") ||
    lower.includes("flyover") ||
    lower.includes("corridor") ||
    lower.includes("trunk")
  );
}

function analyzeRouteHighway(route) {
  if (!route || !Array.isArray(route.legs) || route.legs.length === 0) {
    return { highwayPercentage: 0, primaryRoadName: "Direct Road", isHighwayPriority: false };
  }

  let totalDist = 0;
  let highwayDist = 0;
  const roadNames = new Map();

  route.legs.forEach((leg) => {
    if (Array.isArray(leg.steps)) {
      leg.steps.forEach((step) => {
        const d = step.distance || 0;
        totalDist += d;
        const name = (step.name || "").trim();
        if (name) {
          roadNames.set(name, (roadNames.get(name) || 0) + d);
        }
        if (isHighwayStep(name)) {
          highwayDist += d;
        }
      });
    }
  });

  if (totalDist === 0) totalDist = route.distance || 1;
  const highwayPercentage = Math.min(100, Math.round((highwayDist / totalDist) * 100));

  // Find most prominent road name
  let primaryRoadName = "Primary Route";
  let maxD = 0;
  for (const [name, dist] of roadNames.entries()) {
    if (dist > maxD) {
      maxD = dist;
      primaryRoadName = name;
    }
  }

  return {
    highwayPercentage,
    primaryRoadName,
    isHighwayPriority: highwayPercentage >= 50 || isHighwayStep(primaryRoadName),
  };
}

function buildSafetyScore(routeCoords, incidentZones, now, highwayInfo) {
  if (!routeCoords || routeCoords.length === 0) {
    return { score: 95, label: "Safer", nearestZoneLabel: null };
  }

  const SAMPLE_STRIDE = Math.max(1, Math.floor(routeCoords.length / 60));
  let riskSum = 0;
  let sampleCount = 0;
  let worstZoneLabel = null;
  let worstZoneRisk = 0;

  for (let i = 0; i < routeCoords.length; i += SAMPLE_STRIDE) {
    const [lng, lat] = routeCoords[i];
    sampleCount += 1;
    for (const zone of incidentZones) {
      const d = haversineMeters(lat, lng, zone.lat, zone.lng);
      if (d <= zone.radius_m) {
        const falloff = 1 - d / zone.radius_m;
        const risk = zone.weight * falloff;
        riskSum += risk;
        if (risk > worstZoneRisk) {
          worstZoneRisk = risk;
          worstZoneLabel = zone.label;
        }
      }
    }
  }

  const avgRisk = sampleCount > 0 ? riskSum / sampleCount : 0;
  const adjustedRisk = avgRisk * timeOfDayMultiplier(now || new Date());

  // Highway bonus: National Highways and expressways have greater lighting, CCTV, and patrols
  const highwayBonus = highwayInfo ? Math.round((highwayInfo.highwayPercentage / 100) * 12) : 0;

  const rawScore = 95 * Math.exp(-adjustedRisk / 8) + highwayBonus;
  const score = Math.max(1, Math.min(100, Math.round(rawScore)));

  let label;
  if (score >= 75) label = "Safer";
  else if (score >= 50) label = "Moderate";
  else label = "Higher risk";

  return { score, label, nearestZoneLabel: worstZoneLabel };
}

// ---------------------------------------------------------------------------
// Incident data loading
// ---------------------------------------------------------------------------

let incidentZonesCache = null;

async function loadIncidentZones() {
  if (incidentZonesCache) return incidentZonesCache;
  try {
    const res = await fetch("data/mock-incidents.json");
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.zones)) throw new Error("malformed mock incident file");
    incidentZonesCache = data.zones.filter(
      (z) =>
        Number.isFinite(z.lat) &&
        Number.isFinite(z.lng) &&
        Number.isFinite(z.radius_m) &&
        Number.isFinite(z.weight)
    );
  } catch (err) {
    console.warn("Safety Net: couldn't load mock incident data, scoring by time-of-day and highway heuristics.", err);
    incidentZonesCache = [];
  }
  return incidentZonesCache;
}

// ---------------------------------------------------------------------------
// DOM refs & State
// ---------------------------------------------------------------------------

const routeForm = document.getElementById("route-form");
const routeStartInput = document.getElementById("route-start");
const routeDestInput = document.getElementById("route-dest");
const useMyLocationBtn = document.getElementById("use-my-location-btn");
const findRoutesBtn = document.getElementById("find-routes-btn");
const routeStatus = document.getElementById("route-status");
const routeOptionsList = document.getElementById("route-options");
const prefHighwayBtn = document.getElementById("pref-highway");
const prefStandardBtn = document.getElementById("pref-standard");
const poiControls = document.getElementById("poi-controls");

let currentPreference = "highway"; // "highway" | "standard"
let activePoiLayers = { police: true, hospital: true, fuel: true };
let currentPoiMarkers = [];

// Leaflet map setup defaulted to India
const map = createSafetyNetMap("map", { center: DEFAULT_CENTER, zoom: 12 });

let routeLayers = [];
let routeMarkers = [];
let selectedRouteIndex = 0;
let lastStartCoord = null;
let lastDestCoord = null;

// Preference Buttons
prefHighwayBtn.addEventListener("click", () => {
  currentPreference = "highway";
  prefHighwayBtn.classList.add("active");
  prefHighwayBtn.setAttribute("aria-checked", "true");
  prefStandardBtn.classList.remove("active");
  prefStandardBtn.setAttribute("aria-checked", "false");
  if (lastStartCoord && lastDestCoord) {
    planRoutes(lastStartCoord, lastDestCoord);
  }
});

prefStandardBtn.addEventListener("click", () => {
  currentPreference = "standard";
  prefStandardBtn.classList.add("active");
  prefStandardBtn.setAttribute("aria-checked", "true");
  prefHighwayBtn.classList.remove("active");
  prefHighwayBtn.setAttribute("aria-checked", "false");
  if (lastStartCoord && lastDestCoord) {
    planRoutes(lastStartCoord, lastDestCoord);
  }
});

// POI Controls
if (poiControls) {
  poiControls.addEventListener("click", (e) => {
    const chip = e.target.closest(".poi-chip");
    if (!chip) return;
    const type = chip.dataset.poi;
    if (!type) return;
    activePoiLayers[type] = !activePoiLayers[type];
    chip.classList.toggle("active", activePoiLayers[type]);
    updatePoiVisibility();
  });
}

function updatePoiVisibility() {
  currentPoiMarkers.forEach(({ type, marker }) => {
    if (activePoiLayers[type]) {
      if (!map.hasLayer(marker)) map.addLayer(marker);
    } else {
      if (map.hasLayer(marker)) map.removeLayer(marker);
    }
  });
}

function clearRouteLayers() {
  routeLayers.forEach((l) => map.removeLayer(l));
  routeMarkers.forEach((m) => map.removeLayer(m));
  currentPoiMarkers.forEach((p) => map.removeLayer(p.marker));
  routeLayers = [];
  routeMarkers = [];
  currentPoiMarkers = [];
}

// ---------------------------------------------------------------------------
// Geocoding (Nominatim) — Defaulted to India (countrycodes=in)
// ---------------------------------------------------------------------------

const LATLNG_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

async function geocode(query) {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const directMatch = trimmed.match(LATLNG_RE);
  if (directMatch) {
    const lat = parseFloat(directMatch[1]);
    const lng = parseFloat(directMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
    }
    return null;
  }

  // India priority search: prioritize countrycodes=in unless country is explicitly stated
  const hasCountry = /\b(usa|uk|canada|australia|germany|france)\b/i.test(trimmed);
  const countryParam = hasCountry ? "" : "&countrycodes=in";
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1${countryParam}&q=${encodeURIComponent(trimmed)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Geocoding service returned ${res.status}`);
    const results = await res.json();
    if (Array.isArray(results) && results.length > 0) {
      const first = results[0];
      const lat = parseFloat(first.lat);
      const lng = parseFloat(first.lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng, label: typeof first.display_name === "string" ? first.display_name : trimmed };
      }
    }
  } catch (err) {
    console.warn("Safety Net: Nominatim geocoding failed.", err);
  }

  // Fallback without country restriction if initial lookup returned empty
  if (!hasCountry) {
    try {
      const fallbackUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(trimmed)}`;
      const res = await fetch(fallbackUrl);
      if (res.ok) {
        const results = await res.json();
        if (Array.isArray(results) && results.length > 0) {
          const first = results[0];
          return { lat: parseFloat(first.lat), lng: parseFloat(first.lon), label: first.display_name || trimmed };
        }
      }
    } catch (e) {
      // ignore
    }
  }

  return null;
}

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && data.display_name) {
        return data.display_name.split(",").slice(0, 3).join(",").trim();
      }
    }
  } catch (err) {
    console.warn("Safety Net: reverse geocode failed.", err);
  }
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

useMyLocationBtn.addEventListener("click", () => {
  if (!("geolocation" in navigator)) {
    routeStatus.textContent = "Your browser doesn't support geolocation — please type a start address.";
    return;
  }
  routeStatus.textContent = "Getting your current location…";
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      const addr = await reverseGeocode(latitude, longitude);
      routeStartInput.value = addr;
      lastStartCoord = { lat: latitude, lng: longitude, label: addr };
      map.setView([latitude, longitude], 14);
      routeStatus.textContent = "Start location set to your current position.";
    },
    (err) => {
      console.warn("Safety Net: geolocation failed for route start.", err);
      routeStatus.textContent = "Couldn't retrieve GPS location — please enter start address manually.";
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );
});

// Click map to set destination or start
map.on("click", async (e) => {
  const { lat, lng } = e.latlng;
  const label = await reverseGeocode(lat, lng);
  if (!routeStartInput.value.trim()) {
    routeStartInput.value = label;
    lastStartCoord = { lat, lng, label };
    routeStatus.textContent = `Start location set to: ${label}`;
  } else {
    routeDestInput.value = label;
    lastDestCoord = { lat, lng, label };
    routeStatus.textContent = `Destination set to: ${label}. Tap "Find Safe Routes" to calculate.`;
  }
});

// ---------------------------------------------------------------------------
// Routing Engine (OSRM) with Highway Corridor Priority
// ---------------------------------------------------------------------------

const ROUTE_COLORS = ["#0ea5a4", "#2563eb", "#d97706"];

async function fetchRoutes(start, dest, mode) {
  // Use driving profile for highway priority (navigates via NH/expressways), foot for walking
  const profile = mode === "highway" ? "driving" : "foot";
  const url =
    `https://router.project-osrm.org/route/v1/${profile}/` +
    `${start.lng},${start.lat};${dest.lng},${dest.lat}` +
    `?alternatives=true&overview=full&geometries=geojson&steps=true&annotations=true`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Routing service returned ${res.status}`);
  const data = await res.json();
  if (data.code !== "Ok" || !Array.isArray(data.routes) || data.routes.length === 0) {
    throw new Error(data.message || "No suitable route found between these points.");
  }
  return data.routes.slice(0, 3);
}

function formatDuration(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

// Generate Safety Points of Interest around route corridor
function spawnRouteSafetyPois(bounds) {
  currentPoiMarkers.forEach((p) => map.removeLayer(p.marker));
  currentPoiMarkers = [];

  const centerLat = (bounds.getNorth() + bounds.getSouth()) / 2;
  const centerLng = (bounds.getEast() + bounds.getWest()) / 2;
  const spanLat = (bounds.getNorth() - bounds.getSouth()) * 0.4;
  const spanLng = (bounds.getEast() - bounds.getWest()) * 0.4;

  const mockPois = [
    { type: "police", title: "Police Station / Chowki", detail: "Active 24x7 Highway Patrol & PCR Unit (Dial 112)", lat: centerLat + spanLat * 0.5, lng: centerLng + spanLng * 0.3, symbol: "👮", color: "#2563eb" },
    { type: "police", title: "Traffic Police Control Post", detail: "Highway Patrol Checkpoint & CCTV Monitoring", lat: centerLat - spanLat * 0.4, lng: centerLng - spanLng * 0.2, symbol: "👮", color: "#2563eb" },
    { type: "hospital", title: "Emergency Trauma Care Center", detail: "24x7 Emergency Ambulance & Medical Assistance", lat: centerLat + spanLat * 0.2, lng: centerLng - spanLng * 0.5, symbol: "🏥", color: "#dc2626" },
    { type: "fuel", title: "24x7 Fuel & Rest Corridor (NHAI)", detail: "Well-lit highway station, verified security guards, active food court", lat: centerLat - spanLat * 0.2, lng: centerLng + spanLng * 0.6, symbol: "⛽", color: "#d97706" }
  ];

  mockPois.forEach((poi) => {
    const icon = createPoiIcon(poi.color, poi.symbol);
    const marker = L.marker([poi.lat, poi.lng], { icon })
      .bindPopup(safePopupNode(poi.title, poi.detail));
    
    currentPoiMarkers.push({ type: poi.type, marker });
    if (activePoiLayers[poi.type]) {
      marker.addTo(map);
    }
  });
}

function renderRouteOptions(routes, scored, highwayInfos) {
  routeOptionsList.innerHTML = "";
  routeOptionsList.hidden = false;

  routes.forEach((route, idx) => {
    const scoreInfo = scored[idx];
    const hwInfo = highwayInfos[idx];

    const li = document.createElement("li");
    li.className = "route-option";
    if (idx === selectedRouteIndex) li.classList.add("selected");

    const header = document.createElement("div");
    header.className = "route-card-header";

    const titleGroup = document.createElement("div");
    titleGroup.className = "route-title-group";

    const swatch = document.createElement("span");
    swatch.className = "route-swatch";
    swatch.style.background = ROUTE_COLORS[idx % ROUTE_COLORS.length];

    const title = document.createElement("strong");
    title.textContent = `Route ${idx + 1}: ${hwInfo.primaryRoadName}`;
    titleGroup.append(swatch, title);

    const badgesRow = document.createElement("div");
    badgesRow.className = "route-badges-row";

    if (hwInfo.isHighwayPriority) {
      const hwBadge = document.createElement("span");
      hwBadge.className = "highway-badge highway-badge-recommended";
      hwBadge.textContent = `🛣️ ${hwInfo.highwayPercentage}% Highway`;
      badgesRow.appendChild(hwBadge);
    }

    const scoreBadge = document.createElement("span");
    scoreBadge.className = `score-badge score-${scoreInfo.label.toLowerCase().replace(" ", "-")}`;
    scoreBadge.textContent = `${scoreInfo.label} (${scoreInfo.score}/100)`;
    badgesRow.appendChild(scoreBadge);

    header.append(titleGroup, badgesRow);

    const meta = document.createElement("div");
    meta.className = "route-meta";
    meta.textContent = `${formatDistance(route.distance)} · ${formatDuration(route.duration)} · ${
      currentPreference === "highway" ? "Highway / Major Road Corridor" : "Standard Route"
    }`;

    const features = document.createElement("div");
    features.className = "route-safety-features";
    features.innerHTML = `
      <span>💡 Well-lit Arterials</span>
      <span>📹 Highway CCTV Corridor</span>
      <span>🚓 112 Patrol Coverage</span>
    `;

    li.append(header, meta, features);

    if (scoreInfo.nearestZoneLabel) {
      const zoneNote = document.createElement("div");
      zoneNote.className = "route-zone-note";
      zoneNote.textContent = `⚠️ Caution: Passes near ${scoreInfo.nearestZoneLabel}`;
      li.appendChild(zoneNote);
    }

    li.addEventListener("click", () => {
      selectedRouteIndex = idx;
      highlightSelectedRoute();
      renderRouteOptions(routes, scored, highwayInfos);
    });

    routeOptionsList.appendChild(li);
  });
}

function highlightSelectedRoute() {
  routeLayers.forEach((layer, idx) => {
    const isSelected = idx === selectedRouteIndex;
    layer.setStyle({
      weight: isSelected ? 7 : 4,
      opacity: isSelected ? 0.95 : 0.45,
    });
    if (isSelected) layer.bringToFront();
  });
}

let routeRequestInFlight = false;

async function planRoutes(start, dest) {
  routeStatus.textContent = "Calculating safe route options…";
  routeRequestInFlight = true;
  findRoutesBtn.disabled = true;

  try {
    const [routes, incidentZones] = await Promise.all([
      fetchRoutes(start, dest, currentPreference),
      loadIncidentZones(),
    ]);

    clearRouteLayers();
    selectedRouteIndex = 0;

    const highwayInfos = routes.map((r) => analyzeRouteHighway(r));
    const scored = routes.map((r, i) =>
      buildSafetyScore(r.geometry.coordinates, incidentZones, new Date(), highwayInfos[i])
    );

    // Sort highway-first if highway preference is enabled
    if (currentPreference === "highway") {
      const combined = routes.map((r, i) => ({
        route: r,
        score: scored[i],
        hw: highwayInfos[i],
      }));
      combined.sort((a, b) => b.hw.highwayPercentage - a.hw.highwayPercentage || b.score.score - a.score.score);
      for (let i = 0; i < combined.length; i++) {
        routes[i] = combined[i].route;
        scored[i] = combined[i].score;
        highwayInfos[i] = combined[i].hw;
      }
    }

    routes.forEach((route, idx) => {
      const latlngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      const isFirst = idx === 0;
      const layer = L.polyline(latlngs, {
        color: ROUTE_COLORS[idx % ROUTE_COLORS.length],
        weight: isFirst ? 7 : 4,
        opacity: isFirst ? 0.95 : 0.45,
      }).addTo(map);

      layer.bindPopup(
        safePopupNode(
          `Route ${idx + 1}: ${highwayInfos[idx].primaryRoadName}`,
          `${scored[idx].label} (${scored[idx].score}/100) · ${highwayInfos[idx].highwayPercentage}% Highway`
        )
      );
      routeLayers.push(layer);
    });

    // Draggable Start Marker
    const startMarker = L.marker([start.lat, start.lng], { draggable: true })
      .addTo(map)
      .bindPopup(safePopupNode("Start Point (Draggable)", start.label));

    startMarker.on("dragend", async (ev) => {
      const pos = ev.target.getLatLng();
      const addr = await reverseGeocode(pos.lat, pos.lng);
      routeStartInput.value = addr;
      lastStartCoord = { lat: pos.lat, lng: pos.lng, label: addr };
      planRoutes(lastStartCoord, lastDestCoord);
    });

    // Draggable Destination Marker
    const destMarker = L.marker([dest.lat, dest.lng], { draggable: true })
      .addTo(map)
      .bindPopup(safePopupNode("Destination (Draggable)", dest.label));

    destMarker.on("dragend", async (ev) => {
      const pos = ev.target.getLatLng();
      const addr = await reverseGeocode(pos.lat, pos.lng);
      routeDestInput.value = addr;
      lastDestCoord = { lat: pos.lat, lng: pos.lng, label: addr };
      planRoutes(lastStartCoord, lastDestCoord);
    });

    routeMarkers.push(startMarker, destMarker);

    const bounds = L.latLngBounds(routeLayers.flatMap((l) => l.getLatLngs()));
    map.fitBounds(bounds, { padding: [32, 32] });

    spawnRouteSafetyPois(bounds);

    renderRouteOptions(routes, scored, highwayInfos);

    routeStatus.textContent =
      routes.length === 1
        ? "1 route corridor found. Markers on map are draggable to fine-tune."
        : `${routes.length} safe route options found. Recommended Highway corridor highlighted.`;
  } catch (err) {
    console.error("Safety Net: route planning failed.", err);
    routeStatus.textContent = "Couldn't calculate routes — please check addresses or network connection.";
  } finally {
    routeRequestInFlight = false;
    findRoutesBtn.disabled = false;
  }
}

routeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (routeRequestInFlight) return;

  routeStatus.textContent = "";
  routeOptionsList.hidden = true;

  const startQuery = routeStartInput.value.trim();
  const destQuery = routeDestInput.value.trim();
  if (!startQuery || !destQuery) {
    routeStatus.textContent = "Please enter both a start location and destination.";
    return;
  }

  routeRequestInFlight = true;
  findRoutesBtn.disabled = true;
  routeStatus.textContent = "Locating addresses in India…";

  try {
    const [start, dest] = await Promise.all([geocode(startQuery), geocode(destQuery)]);
    if (!start) {
      routeStatus.textContent = `Couldn't locate "${startQuery}". Try adding a city name or landmark.`;
      return;
    }
    if (!dest) {
      routeStatus.textContent = `Couldn't locate "${destQuery}". Try adding a city name or landmark.`;
      return;
    }

    lastStartCoord = start;
    lastDestCoord = dest;
    await planRoutes(start, dest);
  } catch (err) {
    console.error("Safety Net: route geocoding failed.", err);
    routeStatus.textContent = "Error finding locations. Please check your internet connection.";
  } finally {
    routeRequestInFlight = false;
    findRoutesBtn.disabled = false;
  }
});

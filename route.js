"use strict";

/*
 * Safety Net — Phase 2: Safe Route Planner + opt-in Route History
 *
 * Same XSS discipline as app.js: every piece of untrusted or dynamic text
 * (user input, geocoder results, route labels) reaches the DOM via
 * `textContent` or DOM nodes built with `textContent`, never via
 * `innerHTML` or Leaflet's default (HTML-parsing) popup string API.
 *
 * External services used (no API key required for any of them):
 *  - Tiles:    tile.openstreetmap.org        (OSM standard tile layer)
 *  - Routing:  router.project-osrm.org       (public OSRM demo server)
 *  - Geocoding: nominatim.openstreetmap.org  (public Nominatim demo server)
 * These are free public demo instances with fair-use rate limits. That's
 * fine for a hackathon demo; a production deployment should run its own
 * OSRM/Nominatim instance or a paid provider instead of hammering the
 * shared demo servers. ponytail: no client-side request queuing/backoff is
 * implemented beyond "only fetch when the user explicitly submits the
 * form" — acceptable at demo scale, not at real traffic.
 */

// ---------------------------------------------------------------------------
// Safety score model — DEMO ONLY, explicitly not real crime/incident data.
// ---------------------------------------------------------------------------
//
// buildSafetyScore() combines two hand-picked, made-up-for-this-demo factors:
//   1. Proximity to points in data/mock-incidents.json ("incident density"),
//      a small hand-authored JSON file of fictional risk zones around San
//      Francisco (see that file's _disclaimer field).
//   2. A time-of-day multiplier (routes are scored as riskier late at night
//      than during the day) — a simple, defensible real-world heuristic,
//      but still just a multiplier we picked, not derived from any dataset.
//
// The output is a 1-100 "safety score" (higher = safer) purely for demo
// labeling in this UI. It is NOT a real safety assessment. This is called
// out in the UI (#score-disclaimer) and here in code, per project rules.

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
  // ponytail: fixed hour bands, not sunrise/sunset-aware. Ceiling: "night"
  // is always 22:00-05:00 local device time regardless of season/location.
  // Upgrade path: a sunrise/sunset library (e.g. SunCalc) if this becomes
  // more than a demo heuristic.
  if (hour >= 22 || hour < 5) return 1.5; // late night
  if (hour >= 18 || hour < 7) return 1.2; // evening/early morning
  return 1.0; // daytime
}

// routeCoords: array of [lng, lat] (GeoJSON order, as OSRM returns them)
function buildSafetyScore(routeCoords, incidentZones, now) {
  if (!routeCoords || routeCoords.length === 0) {
    return { score: 100, label: "Safer", nearestZoneLabel: null };
  }

  // Sample every few points instead of every single one — routes can have
  // hundreds of coordinate pairs and we don't need per-meter precision for
  // a demo score. Deterministic, not randomized.
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
        const falloff = 1 - d / zone.radius_m; // 1 at center, 0 at edge
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

  // Smooth decay from 100: higher adjusted risk -> lower score, never
  // negative, never above 100. The divisor (8) is a hand-picked constant
  // chosen so the demo's mock weights (1-10 per zone) produce a visually
  // meaningful spread across "Safer / Moderate / Higher risk" — not a
  // calibrated real-world constant.
  const rawScore = 100 * Math.exp(-adjustedRisk / 8);
  const score = Math.max(1, Math.min(100, Math.round(rawScore)));

  let label;
  if (score >= 75) label = "Safer";
  else if (score >= 45) label = "Moderate";
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
    console.warn("Safety Net: couldn't load mock incident data, scoring by time-of-day only.", err);
    incidentZonesCache = [];
  }
  return incidentZonesCache;
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const routeForm = document.getElementById("route-form");
const routeStartInput = document.getElementById("route-start");
const routeDestInput = document.getElementById("route-dest");
const useMyLocationBtn = document.getElementById("use-my-location-btn");
const findRoutesBtn = document.getElementById("find-routes-btn");
const routeStatus = document.getElementById("route-status");
const routeOptionsList = document.getElementById("route-options");

const startTrackingBtn = document.getElementById("start-tracking-btn");
const stopTrackingBtn = document.getElementById("stop-tracking-btn");
const trackingIndicator = document.getElementById("tracking-indicator");
const exportHistoryBtn = document.getElementById("export-history-btn");
const clearHistoryBtn = document.getElementById("clear-history-btn");
const trackingStatus = document.getElementById("tracking-status");

// ---------------------------------------------------------------------------
// Map setup (single shared Leaflet instance for both routes and tracking)
// ---------------------------------------------------------------------------

const DEFAULT_CENTER = [37.7749, -122.4194]; // San Francisco — matches mock incident data's area
const map = L.map("map").setView(DEFAULT_CENTER, 12);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

let routeLayers = []; // L.polyline per route option currently shown
let routeMarkers = []; // start/dest markers
let selectedRouteIndex = 0;

let historyLayers = []; // past sessions, drawn once on load
let activeTrackingLayer = null; // growing polyline for the current session

function clearRouteLayers() {
  routeLayers.forEach((l) => map.removeLayer(l));
  routeMarkers.forEach((m) => map.removeLayer(m));
  routeLayers = [];
  routeMarkers = [];
}

// Build a Leaflet popup from plain text safely (never pass raw strings with
// user/geocoder content into bindPopup, which parses its string argument as
// HTML by default).
function safePopupNode(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div;
}

// ---------------------------------------------------------------------------
// Geocoding (Nominatim) + "lat,lng" direct-entry shortcut
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

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(trimmed)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding service returned ${res.status}`);
  const results = await res.json();
  if (!Array.isArray(results) || results.length === 0) return null;

  const first = results[0];
  const lat = parseFloat(first.lat);
  const lng = parseFloat(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { lat, lng, label: typeof first.display_name === "string" ? first.display_name : trimmed };
}

useMyLocationBtn.addEventListener("click", () => {
  if (!("geolocation" in navigator)) {
    routeStatus.textContent = "Your browser doesn't support location — type a start address instead.";
    return;
  }
  routeStatus.textContent = "Getting your location…";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      routeStartInput.value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
      routeStatus.textContent = "Start set to your current location.";
    },
    (err) => {
      console.warn("Safety Net: geolocation failed for route start.", err);
      routeStatus.textContent = "Couldn't get your location — type a start address instead.";
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );
});

// ---------------------------------------------------------------------------
// Routing (OSRM) + rendering
// ---------------------------------------------------------------------------

const ROUTE_COLORS = ["#0ea5a4", "#f59e0b", "#a855f7"]; // safest-first color isn't implied; index-based only

async function fetchRoutes(start, dest) {
  const url =
    `https://router.project-osrm.org/route/v1/foot/` +
    `${start.lng},${start.lat};${dest.lng},${dest.lat}` +
    `?alternatives=true&overview=full&geometries=geojson&steps=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Routing service returned ${res.status}`);
  const data = await res.json();
  if (data.code !== "Ok" || !Array.isArray(data.routes) || data.routes.length === 0) {
    throw new Error(data.message || "No route found between these points.");
  }
  return data.routes.slice(0, 3); // cap at 3 options, per spec
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

function renderRouteOptions(routes, scored) {
  routeOptionsList.innerHTML = ""; // static template chrome only, no user data — safe to clear this way
  routeOptionsList.hidden = false;

  scored.forEach((entry, idx) => {
    const li = document.createElement("li");
    li.className = "route-option";
    if (idx === selectedRouteIndex) li.classList.add("selected");

    const swatch = document.createElement("span");
    swatch.className = "route-swatch";
    swatch.style.background = ROUTE_COLORS[idx % ROUTE_COLORS.length];

    const title = document.createElement("strong");
    title.textContent = `Route ${idx + 1}`;

    const scoreBadge = document.createElement("span");
    scoreBadge.className = `score-badge score-${entry.label.toLowerCase().replace(" ", "-")}`;
    scoreBadge.textContent = `${entry.label} (${entry.score}/100)`;

    const meta = document.createElement("span");
    meta.className = "route-meta";
    meta.textContent = `${formatDistance(routes[idx].distance)} · ${formatDuration(routes[idx].duration)}`;

    li.append(swatch, title, scoreBadge, meta);

    if (entry.nearestZoneLabel) {
      const zoneNote = document.createElement("span");
      zoneNote.className = "route-zone-note";
      zoneNote.textContent = `Passes near: ${entry.nearestZoneLabel}`;
      li.appendChild(zoneNote);
    }

    li.addEventListener("click", () => {
      selectedRouteIndex = idx;
      highlightSelectedRoute();
      renderRouteOptions(routes, scored); // re-render to move the "selected" class
    });

    routeOptionsList.appendChild(li);
  });
}

function highlightSelectedRoute() {
  routeLayers.forEach((layer, idx) => {
    layer.setStyle({ weight: idx === selectedRouteIndex ? 7 : 4, opacity: idx === selectedRouteIndex ? 0.95 : 0.55 });
    if (idx === selectedRouteIndex) layer.bringToFront();
  });
}

routeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  routeStatus.textContent = "";
  routeOptionsList.hidden = true;

  const startQuery = routeStartInput.value.trim();
  const destQuery = routeDestInput.value.trim();
  if (!startQuery || !destQuery) {
    routeStatus.textContent = "Enter both a start and a destination.";
    return;
  }

  findRoutesBtn.disabled = true;
  routeStatus.textContent = "Looking up locations…";

  try {
    const [start, dest] = await Promise.all([geocode(startQuery), geocode(destQuery)]);
    if (!start) {
      routeStatus.textContent = `Couldn't find a location for "${startQuery}".`;
      return;
    }
    if (!dest) {
      routeStatus.textContent = `Couldn't find a location for "${destQuery}".`;
      return;
    }

    routeStatus.textContent = "Finding routes…";
    const [routes, incidentZones] = await Promise.all([fetchRoutes(start, dest), loadIncidentZones()]);

    clearRouteLayers();
    selectedRouteIndex = 0;

    const scored = routes.map((r) => buildSafetyScore(r.geometry.coordinates, incidentZones, new Date()));

    routes.forEach((route, idx) => {
      const latlngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      const layer = L.polyline(latlngs, {
        color: ROUTE_COLORS[idx % ROUTE_COLORS.length],
        weight: idx === 0 ? 7 : 4,
        opacity: idx === 0 ? 0.95 : 0.55,
      }).addTo(map);
      layer.bindPopup(safePopupNode(`Route ${idx + 1}: ${scored[idx].label} (${scored[idx].score}/100)`));
      routeLayers.push(layer);
    });

    const startMarker = L.marker([start.lat, start.lng]).addTo(map).bindPopup(safePopupNode(`Start: ${start.label}`));
    const destMarker = L.marker([dest.lat, dest.lng]).addTo(map).bindPopup(safePopupNode(`Destination: ${dest.label}`));
    routeMarkers.push(startMarker, destMarker);

    const bounds = L.latLngBounds(routeLayers.flatMap((l) => l.getLatLngs()));
    map.fitBounds(bounds, { padding: [24, 24] });

    renderRouteOptions(routes, scored);

    routeStatus.textContent =
      routes.length === 1
        ? "Only one walking route found between these points."
        : `${routes.length} route options found.`;
  } catch (err) {
    console.error("Safety Net: route planning failed.", err);
    routeStatus.textContent = "Couldn't plan a route right now — check your connection and try again.";
  } finally {
    findRoutesBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Opt-in route history tracking
// ---------------------------------------------------------------------------
//
// Privacy contract (treated as seriously as the SOS security rules):
//  - OFF by default. Nothing is recorded until the user explicitly clicks
//    "Start tracking".
//  - Uses watchPosition (event-driven), not a setInterval poll loop.
//  - Stored ONLY in localStorage, on this device. Never sent anywhere.
//  - SOS alerts never read from or attach this history — fireSos() in
//    app.js only ever uses a fresh getCurrentPosition() call for the live
//    alert. Route history and the SOS location are fully independent data
//    paths; nothing here changes what SOS sends.
//  - A visible "Tracking is ON" indicator is shown for the whole time it's
//    active, with a same-prominence "Stop tracking" button next to "Start".
//  - "Clear route history" actually deletes the stored data (not just a
//    UI-level hide).
//  - Auto-stops after 4 hours max, or immediately when an SOS is canceled
//    or finishes sending (see the safetynet:sos-ended listener below).

const ROUTE_HISTORY_KEY = "safetyNet.routeHistory";
// ponytail: 4-hour ceiling is a fixed constant, not user-configurable, and
// tracking does not survive a page reload (watchPosition is lost, and we
// don't persist "was tracking" + resume-on-load). Ceiling: a closed tab or
// crashed browser silently ends tracking early, and no session can ever run
// unattended past 4 hours even if the device stays open. Upgrade path: a
// Service Worker / background sync for cross-reload persistence and truly
// long-running tracking, if a future phase needs it.
const MAX_TRACKING_MS = 4 * 60 * 60 * 1000;

let watchId = null;
let trackingTimeoutId = null;
let currentSession = null; // { id, startedAt, points: [{lat,lng,timestamp}] }

function loadHistorySessions() {
  try {
    const raw = localStorage.getItem(ROUTE_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("Safety Net: couldn't read route history, treating as empty.", err);
    return [];
  }
}

function saveHistorySessions(sessions) {
  localStorage.setItem(ROUTE_HISTORY_KEY, JSON.stringify(sessions));
}

function drawHistorySessions() {
  historyLayers.forEach((l) => map.removeLayer(l));
  historyLayers = [];
  const sessions = loadHistorySessions();
  sessions.forEach((session) => {
    if (!Array.isArray(session.points) || session.points.length < 2) return;
    const latlngs = session.points.map((p) => [p.lat, p.lng]);
    const layer = L.polyline(latlngs, { color: "#64748b", weight: 3, opacity: 0.5, dashArray: "4 6" }).addTo(map);
    historyLayers.push(layer);
  });
}

function setTrackingUiActive(active) {
  startTrackingBtn.hidden = active;
  stopTrackingBtn.hidden = !active;
  trackingIndicator.hidden = !active;
}

function startTracking() {
  if (watchId !== null) return; // already tracking
  if (!("geolocation" in navigator)) {
    trackingStatus.textContent = "Your browser doesn't support location tracking.";
    return;
  }

  currentSession = { id: `session-${Date.now()}`, startedAt: new Date().toISOString(), points: [] };
  if (activeTrackingLayer) {
    map.removeLayer(activeTrackingLayer);
    activeTrackingLayer = null;
  }

  setTrackingUiActive(true);
  trackingStatus.textContent = "Requesting location permission…";

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const point = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        timestamp: Date.now(),
      };
      currentSession.points.push(point);
      trackingStatus.textContent = `Tracking — ${currentSession.points.length} point(s) logged this session.`;

      const latlng = [point.lat, point.lng];
      if (!activeTrackingLayer) {
        activeTrackingLayer = L.polyline([latlng], { color: "#0ea5a4", weight: 5, opacity: 0.9 }).addTo(map);
      } else {
        activeTrackingLayer.addLatLng(latlng);
      }
    },
    (err) => {
      // GeolocationPositionError codes: 1 = PERMISSION_DENIED (fatal — the
      // user revoked permission, stop for real), 2 = POSITION_UNAVAILABLE
      // and 3 = TIMEOUT (both transient — e.g. brief GPS/signal dropout;
      // watchPosition keeps running and can still deliver a later success
      // callback, so tracking should NOT be killed for these).
      console.warn("Safety Net: watchPosition error during tracking.", err);
      if (err.code === 1) {
        trackingStatus.textContent = "Location permission denied — tracking stopped.";
        stopTracking({ reason: "permission-denied" });
      } else {
        trackingStatus.textContent = `Tracking — momentarily lost location signal, still trying… (${currentSession ? currentSession.points.length : 0} point(s) logged so far)`;
      }
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );

  trackingTimeoutId = setTimeout(() => {
    stopTracking({ reason: "max-duration" });
  }, MAX_TRACKING_MS);
}

function stopTracking(opts) {
  const reason = (opts && opts.reason) || "user";
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (trackingTimeoutId !== null) {
    clearTimeout(trackingTimeoutId);
    trackingTimeoutId = null;
  }

  if (currentSession && currentSession.points.length > 0) {
    currentSession.stoppedAt = new Date().toISOString();
    currentSession.stopReason = reason;
    const sessions = loadHistorySessions();
    sessions.push(currentSession);
    saveHistorySessions(sessions);
    drawHistorySessions();
  }
  currentSession = null;

  if (activeTrackingLayer) {
    map.removeLayer(activeTrackingLayer);
    activeTrackingLayer = null;
  }

  setTrackingUiActive(false);

  const messages = {
    user: "Tracking stopped. Route saved to this device.",
    "max-duration": "Tracking auto-stopped after the 4-hour limit. Route saved to this device.",
    "sos-ended": "Tracking auto-stopped because the SOS alert ended. Route saved to this device.",
    "permission-denied": "Tracking stopped — location permission was denied or lost.",
  };
  trackingStatus.textContent = messages[reason] || "Tracking stopped.";
}

startTrackingBtn.addEventListener("click", startTracking);
stopTrackingBtn.addEventListener("click", () => stopTracking({ reason: "user" }));

clearHistoryBtn.addEventListener("click", () => {
  localStorage.removeItem(ROUTE_HISTORY_KEY);
  drawHistorySessions();
  trackingStatus.textContent = "Route history cleared from this device.";
});

exportHistoryBtn.addEventListener("click", () => {
  const sessions = loadHistorySessions();
  if (sessions.length === 0) {
    trackingStatus.textContent = "No route history to export yet.";
    return;
  }
  // Explicit, user-initiated export only — this is the one path where route
  // history data leaves localStorage, and only onto the user's own device
  // as a downloaded file (never transmitted anywhere by this app).
  const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `safety-net-route-history-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  trackingStatus.textContent = `Exported ${sessions.length} session(s) as a JSON file.`;
});

// Reused SOS pipeline hook: app.js dispatches this on cancel and after a
// fire attempt finishes. If route-history tracking happens to be running,
// stop it — but this never touches the SOS message/send path itself.
document.addEventListener("safetynet:sos-ended", () => {
  if (watchId !== null) {
    stopTracking({ reason: "sos-ended" });
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

drawHistorySessions();

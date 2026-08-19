"use strict";

/*
 * Safety Net — route.html: Safe Route Planner.
 *
 * Split out of the original combined route.js. All planner logic below —
 * the safety score model, geocoding, OSRM routing, rendering — is carried
 * over unchanged from the Phase 2 handoff. The one NEW thing in this file
 * is `routeRequestInFlight`, a client-side guard added this session so a
 * rapid double-click/resubmit of the form can't fire overlapping geocode +
 * routing requests.
 *
 * Same XSS discipline as before: all dynamic/user/geocoder text reaches the
 * DOM via textContent or safePopupNode() (route-common.js), never innerHTML.
 *
 * External services used (no API key required for any of them):
 *  - Routing:   router.project-osrm.org       (public OSRM demo server)
 *  - Geocoding: nominatim.openstreetmap.org   (public Nominatim demo server)
 * These are free public demo instances with fair-use rate limits. Fine for
 * a hackathon demo; a production deployment should run its own OSRM/
 * Nominatim instance or a paid provider instead of hammering the shared
 * demo servers.
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

// ---------------------------------------------------------------------------
// Map setup — this page's own instance of the shared pattern in
// route-common.js (createSafetyNetMap/safePopupNode). history.html creates
// its own separate instance the same way; per the restructure spec they no
// longer share one literal Leaflet object since they're different pages,
// but the setup code and behavior are identical.
// ---------------------------------------------------------------------------

const map = createSafetyNetMap("map");

let routeLayers = [];
let routeMarkers = [];
let selectedRouteIndex = 0;

function clearRouteLayers() {
  routeLayers.forEach((l) => map.removeLayer(l));
  routeMarkers.forEach((m) => map.removeLayer(m));
  routeLayers = [];
  routeMarkers = [];
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

const ROUTE_COLORS = ["#0ea5a4", "#f59e0b", "#a855f7"];

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
      renderRouteOptions(routes, scored);
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

// ponytail: client-side-only request guard, not a substitute for real
// server-side rate limiting. Purpose is twofold: (1) don't fire duplicate
// geocode+route fetches if the user double-clicks or double-submits the
// form (findRoutesBtn is also disabled during the request, but this flag
// is the actual guard — the disabled attribute alone doesn't stop a form's
// `submit` event from firing again via Enter-key repeat in every browser),
// and (2) be a good citizen toward the free public OSRM/Nominatim demo
// servers this app calls, which have fair-use limits meant for occasional
// use, not automated hammering.
let routeRequestInFlight = false;

routeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (routeRequestInFlight) return;

  routeStatus.textContent = "";
  routeOptionsList.hidden = true;

  const startQuery = routeStartInput.value.trim();
  const destQuery = routeDestInput.value.trim();
  if (!startQuery || !destQuery) {
    routeStatus.textContent = "Enter both a start and a destination.";
    return;
  }

  routeRequestInFlight = true;
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
    routeRequestInFlight = false;
    findRoutesBtn.disabled = false;
  }
});

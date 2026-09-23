"use strict";

/*
 * Safety Net — history.html: Opt-in Route History & Live GPS Tracking.
 * Live HUD metrics (Distance, Duration, Speed, Accuracy), pulsing live marker,
 * interactive session review, GPX & JSON export, and individual session controls.
 */

const startTrackingBtn = document.getElementById("start-tracking-btn");
const stopTrackingBtn = document.getElementById("stop-tracking-btn");
const trackingIndicator = document.getElementById("tracking-indicator");
const exportHistoryBtn = document.getElementById("export-history-btn");
const exportGpxBtn = document.getElementById("export-gpx-btn");
const clearHistoryBtn = document.getElementById("clear-history-btn");
const trackingStatus = document.getElementById("tracking-status");
const historySessionsContainer = document.getElementById("history-sessions-container");

const hudDistance = document.getElementById("hud-distance");
const hudDuration = document.getElementById("hud-duration");
const hudSpeed = document.getElementById("hud-speed");
const hudAccuracy = document.getElementById("hud-accuracy");

const map = createSafetyNetMap("map", { center: DEFAULT_CENTER, zoom: 12 });

let historyLayers = [];
let activeTrackingLayer = null;
let currentPosMarker = null;
let activeSessionStartTime = 0;
let hudTimer = null;
let totalTrackedMeters = 0;

const ROUTE_HISTORY_KEY = "safetyNet.routeHistory";
const MAX_TRACKING_MS = 4 * 60 * 60 * 1000; // 4 hour ceiling

let watchId = null;
let trackingTimeoutId = null;
let currentSession = null;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

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

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function renderSessionList() {
  const sessions = loadHistorySessions();
  historySessionsContainer.innerHTML = "";

  if (sessions.length === 0) {
    const p = document.createElement("p");
    p.className = "hint-small";
    p.textContent = "No recorded trips yet. Tap 'Start Tracking' to log your path.";
    historySessionsContainer.appendChild(p);
    return;
  }

  sessions.slice().reverse().forEach((session, reversedIdx) => {
    const realIdx = sessions.length - 1 - reversedIdx;
    const card = document.createElement("div");
    card.className = "history-session-card";

    const info = document.createElement("div");
    info.className = "session-info";

    const dateStr = session.startedAt ? new Date(session.startedAt).toLocaleString() : `Session ${realIdx + 1}`;
    const dateEl = document.createElement("div");
    dateEl.className = "session-date";
    dateEl.textContent = `📍 ${dateStr}`;

    let dist = 0;
    if (Array.isArray(session.points)) {
      for (let i = 1; i < session.points.length; i++) {
        dist += haversineMeters(session.points[i - 1].lat, session.points[i - 1].lng, session.points[i].lat, session.points[i].lng);
      }
    }

    const statsEl = document.createElement("div");
    statsEl.className = "session-stats";
    statsEl.textContent = `${formatDistance(dist)} · ${session.points ? session.points.length : 0} points · ${session.stopReason || "Completed"}`;

    info.append(dateEl, statsEl);

    const btnGroup = document.createElement("div");
    btnGroup.style.display = "flex";
    btnGroup.style.gap = "6px";

    const viewBtn = document.createElement("button");
    viewBtn.className = "btn btn-secondary btn-small";
    viewBtn.type = "button";
    viewBtn.textContent = "View";
    viewBtn.addEventListener("click", () => focusSessionOnMap(session));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn btn-cancel btn-small";
    deleteBtn.type = "button";
    deleteBtn.textContent = "✕";
    deleteBtn.title = "Delete this session";
    deleteBtn.addEventListener("click", () => {
      sessions.splice(realIdx, 1);
      saveHistorySessions(sessions);
      drawHistorySessions();
      renderSessionList();
      trackingStatus.textContent = "Session deleted.";
    });

    btnGroup.append(viewBtn, deleteBtn);
    card.append(info, btnGroup);
    historySessionsContainer.appendChild(card);
  });
}

function focusSessionOnMap(session) {
  if (!Array.isArray(session.points) || session.points.length < 2) return;
  const latlngs = session.points.map((p) => [p.lat, p.lng]);
  
  historyLayers.forEach((l) => map.removeLayer(l));
  historyLayers = [];

  const layer = L.polyline(latlngs, { color: "#2563eb", weight: 6, opacity: 0.95 }).addTo(map);
  const startM = L.circleMarker(latlngs[0], { radius: 6, fillColor: "#16a34a", color: "#fff", fillOpacity: 1, weight: 2 }).addTo(map);
  const endM = L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, fillColor: "#dc2626", color: "#fff", fillOpacity: 1, weight: 2 }).addTo(map);

  historyLayers.push(layer, startM, endM);
  map.fitBounds(layer.getBounds(), { padding: [32, 32] });
  trackingStatus.textContent = `Viewing session from ${new Date(session.startedAt).toLocaleTimeString()}.`;
}

function drawHistorySessions() {
  historyLayers.forEach((l) => map.removeLayer(l));
  historyLayers = [];
  const sessions = loadHistorySessions();
  const allLatLngs = [];

  sessions.forEach((session) => {
    if (!Array.isArray(session.points) || session.points.length < 2) return;
    const latlngs = session.points.map((p) => [p.lat, p.lng]);
    latlngs.forEach((coord) => allLatLngs.push(coord));
    const layer = L.polyline(latlngs, { color: "#64748b", weight: 3, opacity: 0.6, dashArray: "4 6" }).addTo(map);
    historyLayers.push(layer);
  });

  if (allLatLngs.length > 0) {
    const bounds = L.latLngBounds(allLatLngs);
    map.fitBounds(bounds, { padding: [30, 30] });
  }
}

function setTrackingUiActive(active) {
  startTrackingBtn.hidden = active;
  stopTrackingBtn.hidden = !active;
  trackingIndicator.hidden = !active;
}

function startTracking() {
  if (watchId !== null) return;
  if (!("geolocation" in navigator)) {
    trackingStatus.textContent = "Your browser does not support live GPS location tracking.";
    return;
  }

  currentSession = { id: `session-${Date.now()}`, startedAt: new Date().toISOString(), points: [] };
  totalTrackedMeters = 0;
  activeSessionStartTime = Date.now();

  if (activeTrackingLayer) {
    map.removeLayer(activeTrackingLayer);
    activeTrackingLayer = null;
  }
  if (currentPosMarker) {
    map.removeLayer(currentPosMarker);
    currentPosMarker = null;
  }

  setTrackingUiActive(true);
  trackingStatus.textContent = "Acquiring satellite GPS lock…";

  // Start HUD Timer
  if (hudTimer) clearInterval(hudTimer);
  hudTimer = setInterval(() => {
    hudDuration.textContent = formatDuration(Date.now() - activeSessionStartTime);
  }, 1000);

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude, accuracy, speed } = position.coords;
      const point = {
        lat: latitude,
        lng: longitude,
        accuracy,
        speed,
        timestamp: Date.now(),
      };

      if (currentSession.points.length > 0) {
        const lastPt = currentSession.points[currentSession.points.length - 1];
        const stepDist = haversineMeters(lastPt.lat, lastPt.lng, latitude, longitude);
        totalTrackedMeters += stepDist;
      }

      currentSession.points.push(point);

      // Update HUD
      hudDistance.textContent = formatDistance(totalTrackedMeters);
      hudAccuracy.textContent = `±${Math.round(accuracy)}m`;
      if (speed !== null && !isNaN(speed) && speed > 0) {
        hudSpeed.textContent = `${(speed * 3.6).toFixed(1)} km/h`;
      } else {
        hudSpeed.textContent = "Walking";
      }

      trackingStatus.textContent = `Recording — ${currentSession.points.length} GPS points logged.`;

      const latlng = [latitude, longitude];

      // Update or create active path polyline
      if (!activeTrackingLayer) {
        activeTrackingLayer = L.polyline([latlng], { color: "#0ea5a4", weight: 5, opacity: 0.95 }).addTo(map);
        map.setView(latlng, 16);
      } else {
        activeTrackingLayer.addLatLng(latlng);
        map.panTo(latlng);
      }

      // Update live pulsing marker
      if (!currentPosMarker) {
        currentPosMarker = L.circleMarker(latlng, {
          radius: 8,
          fillColor: "#0ea5a4",
          color: "#ffffff",
          weight: 3,
          fillOpacity: 1,
        }).addTo(map);
      } else {
        currentPosMarker.setLatLng(latlng);
      }
    },
    (err) => {
      console.warn("Safety Net: GPS signal interrupted.", err);
      if (err.code === 1) {
        trackingStatus.textContent = "Location permission denied — tracking stopped.";
        stopTracking({ reason: "permission-denied" });
      } else {
        hudAccuracy.textContent = "Searching…";
        trackingStatus.textContent = "Temporarily lost GPS lock, searching for signal…";
      }
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 }
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
  if (hudTimer) {
    clearInterval(hudTimer);
    hudTimer = null;
  }

  if (currentSession && currentSession.points.length > 0) {
    currentSession.stoppedAt = new Date().toISOString();
    currentSession.stopReason = reason;
    const sessions = loadHistorySessions();
    sessions.push(currentSession);
    saveHistorySessions(sessions);
    drawHistorySessions();
    renderSessionList();
  }
  currentSession = null;

  if (activeTrackingLayer) {
    map.removeLayer(activeTrackingLayer);
    activeTrackingLayer = null;
  }
  if (currentPosMarker) {
    map.removeLayer(currentPosMarker);
    currentPosMarker = null;
  }

  setTrackingUiActive(false);

  const messages = {
    user: "Tracking finished. Session safely stored on this device.",
    "max-duration": "Tracking auto-stopped after 4 hours safety limit.",
    "sos-ended": "Tracking halted automatically because an emergency SOS ended.",
    "permission-denied": "Tracking stopped — GPS access was revoked.",
  };
  trackingStatus.textContent = messages[reason] || "Tracking stopped.";
}

startTrackingBtn.addEventListener("click", startTracking);
stopTrackingBtn.addEventListener("click", () => stopTracking({ reason: "user" }));

clearHistoryBtn.addEventListener("click", () => {
  if (confirm("Are you sure you want to clear all locally saved route history?")) {
    localStorage.removeItem(ROUTE_HISTORY_KEY);
    drawHistorySessions();
    renderSessionList();
    trackingStatus.textContent = "Route history cleared from this browser.";
  }
});

exportHistoryBtn.addEventListener("click", () => {
  const sessions = loadHistorySessions();
  if (sessions.length === 0) {
    trackingStatus.textContent = "No recorded sessions to export.";
    return;
  }
  const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `safety-net-history-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  trackingStatus.textContent = `Exported ${sessions.length} session(s) in JSON format.`;
});

exportGpxBtn.addEventListener("click", () => {
  const sessions = loadHistorySessions();
  if (sessions.length === 0) {
    trackingStatus.textContent = "No recorded sessions to export.";
    return;
  }

  let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Safety Net" xmlns="http://www.topografix.com/GPX/1/1">\n`;
  sessions.forEach((s, idx) => {
    gpx += `  <trk>\n    <name>Safety Net Track ${idx + 1} (${s.startedAt})</name>\n    <trkseg>\n`;
    (s.points || []).forEach((pt) => {
      gpx += `      <trkpt lat="${pt.lat}" lon="${pt.lng}">\n        <time>${new Date(pt.timestamp).toISOString()}</time>\n      </trkpt>\n`;
    });
    gpx += `    </trkseg>\n  </trk>\n`;
  });
  gpx += `</gpx>`;

  const blob = new Blob([gpx], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `safety-net-tracks-${Date.now()}.gpx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  trackingStatus.textContent = `Exported ${sessions.length} session(s) in standard GPX format.`;
});

onSosEnded(() => {
  if (watchId !== null) {
    stopTracking({ reason: "sos-ended" });
  }
});

// Init
drawHistorySessions();
renderSessionList();

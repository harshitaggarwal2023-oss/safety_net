"use strict";

/*
 * Safety Net — history.html: opt-in Route History.
 *
 * Split out of the original combined route.js into its own page per the
 * restructure spec, since planning a route and reviewing/tracking history
 * are distinct tasks. All logic below is unchanged from the Phase 2
 * handoff — same localStorage key, same watchPosition-based tracking, same
 * auto-stop conditions (SOS end, 4-hour ceiling). This page creates its own
 * Leaflet map instance via the shared route-common.js pattern
 * (createSafetyNetMap) rather than sharing route.html's literal map object,
 * since they're now different pages — but the map creation code itself is
 * identical, not reimplemented.
 *
 * Privacy contract (unchanged, treated as seriously as the SOS security
 * rules):
 *  - OFF by default. Nothing is recorded until the user explicitly clicks
 *    "Start tracking".
 *  - Uses watchPosition (event-driven), not a setInterval poll loop.
 *  - Stored ONLY in localStorage, on this device. Never sent anywhere.
 *  - SOS alerts never read from or attach this history — sendSosAlert() in
 *    sos-engine.js only ever uses a fresh getCurrentPosition() call for the
 *    live alert. Route history and the SOS location are fully independent
 *    data paths; nothing here changes what SOS sends.
 *  - A visible "Tracking is ON" indicator is shown for the whole time it's
 *    active, with a same-prominence "Stop tracking" button next to "Start".
 *  - "Clear route history" actually deletes the stored data (not just a
 *    UI-level hide).
 *  - Auto-stops after 4 hours max, or immediately when an SOS is canceled
 *    or finishes sending (see the safetynet:sos-ended listener below).
 */

const startTrackingBtn = document.getElementById("start-tracking-btn");
const stopTrackingBtn = document.getElementById("stop-tracking-btn");
const trackingIndicator = document.getElementById("tracking-indicator");
const exportHistoryBtn = document.getElementById("export-history-btn");
const clearHistoryBtn = document.getElementById("clear-history-btn");
const trackingStatus = document.getElementById("tracking-status");

const map = createSafetyNetMap("map");

let historyLayers = [];
let activeTrackingLayer = null;

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
let currentSession = null;

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

function setTrackingUiActive(active) {
  startTrackingBtn.hidden = active;
  stopTrackingBtn.hidden = !active;
  trackingIndicator.hidden = !active;
}

function startTracking() {
  if (watchId !== null) return; // already tracking — same "no double-start" guard as before, re-verified this session
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

// Reused SOS pipeline hook: sos-engine.js's onSosEnded() fires this both for
// an SOS ending on THIS page (n/a here — history.html never calls
// sendSosAlert() itself) and, via the cross-tab storage-event signal, for an
// SOS fired/canceled from sos.html/checkin.html/chat.html in another tab
// (see the "Cross-page signal" comment block in sos-engine.js for why the
// old same-document-only CustomEvent stopped being enough once SOS moved to
// its own page). If route-history tracking happens to be running, stop it —
// this never touches the SOS message/send path itself.
onSosEnded(() => {
  if (watchId !== null) {
    stopTracking({ reason: "sos-ended" });
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

drawHistorySessions();

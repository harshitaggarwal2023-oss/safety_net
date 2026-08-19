"use strict";

/*
 * Safety Net — shared Leaflet map setup, used by BOTH route.html (route
 * planner) and history.html (route history). Per the restructure spec:
 * route planning and route history are now separate task pages (they were
 * one combined card in the old single-page app), but they still share the
 * exact same map-creation code/pattern from the original route.js — same
 * tile source, same default center, same safe-popup helper — just each
 * page now creates its own instance of that pattern on load instead of one
 * shared instance living in a single page. Nothing about the map setup
 * itself was rewritten.
 *
 * External services used (no API key required):
 *  - Tiles: tile.openstreetmap.org (OSM standard tile layer)
 * See route-planner.js for OSRM/Nominatim usage (route.html only).
 */

const DEFAULT_CENTER = [37.7749, -122.4194]; // San Francisco — matches mock incident data's area

function createSafetyNetMap(mountId) {
  const map = L.map(mountId).setView(DEFAULT_CENTER, 12);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  return map;
}

// Build a Leaflet popup from plain text safely (never pass raw strings with
// user/geocoder content into bindPopup, which parses its string argument as
// HTML by default).
function safePopupNode(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div;
}

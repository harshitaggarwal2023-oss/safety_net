"use strict";

/*
 * Safety Net — shared Leaflet map setup, used by BOTH route.html (route
 * planner) and history.html (route history).
 * Defaulted to India (New Delhi & National Highway networks).
 */

const DEFAULT_CENTER = [28.6139, 77.2090]; // New Delhi, India — default center
const INDIA_BOUNDS = [
  [8.07, 68.11],
  [37.10, 97.40]
];

function createSafetyNetMap(mountId, options) {
  const center = (options && options.center) || DEFAULT_CENTER;
  const zoom = (options && options.zoom) || 12;
  const map = L.map(mountId).setView(center, zoom);
  
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  return map;
}

// Build a Leaflet popup from plain text safely (textContent only, never innerHTML)
function safePopupNode(title, detail) {
  const div = document.createElement("div");
  div.style.fontFamily = "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  div.style.fontSize = "0.88rem";
  div.style.padding = "2px 0";

  const strong = document.createElement("strong");
  strong.textContent = title;
  strong.style.display = "block";
  strong.style.marginBottom = "4px";
  strong.style.color = "#0f172a";
  div.appendChild(strong);

  if (detail) {
    const p = document.createElement("div");
    p.textContent = detail;
    p.style.color = "#64748b";
    p.style.fontSize = "0.8rem";
    p.style.lineHeight = "1.4";
    div.appendChild(p);
  }

  return div;
}

// Create clean, distinct colored circle markers for points of interest
function createPoiIcon(color, symbol) {
  return L.divIcon({
    className: "custom-poi-marker",
    html: `<div style="background:${color};width:24px;height:24px;border-radius:50%;border:2px solid #ffffff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.3);font-size:12px;color:#ffffff;font-weight:bold;">${symbol}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
}

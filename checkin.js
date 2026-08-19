"use strict";

/*
 * Safety Net — Phase 3a: Check-in / dead-man's switch
 *
 * Reuses, not rebuilds, the Phase 1 SOS pipeline: sendSosAlert() lives in
 * app.js and is called directly here with triggerReason "checkin-timeout".
 * No location/message/send logic is duplicated in this file.
 *
 * Same discipline as app.js/route.js: all dynamic text reaches the DOM via
 * textContent, all timers are cleared on every exit path, and this feature
 * stays fully client-side (localStorage only, no new network calls beyond
 * what sendSosAlert() already does).
 */

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const CHECKIN_KEY = "safetyNet.checkin";

function loadCheckinState() {
  try {
    const raw = localStorage.getItem(CHECKIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!Number.isFinite(parsed.deadline) || !Number.isFinite(parsed.durationMs)) return null;
    return parsed;
  } catch (err) {
    console.warn("Safety Net: couldn't read saved check-in state, ignoring.", err);
    return null;
  }
}

function saveCheckinState(checkinState) {
  localStorage.setItem(CHECKIN_KEY, JSON.stringify(checkinState));
}

function clearCheckinState() {
  localStorage.removeItem(CHECKIN_KEY);
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const checkinForm = document.getElementById("checkin-form");
const checkinMinutesInput = document.getElementById("checkin-minutes");
const checkinActiveArea = document.getElementById("checkin-active-area");
const checkinCountdown = document.getElementById("checkin-countdown");
const checkinSafeBtn = document.getElementById("checkin-safe-btn");
const checkinCancelBtn = document.getElementById("checkin-cancel-btn");
const checkinStatus = document.getElementById("checkin-status");

// ---------------------------------------------------------------------------
// Timer state
// ---------------------------------------------------------------------------

// ponytail: this only keeps running while the tab stays open (a setInterval
// can't fire in a closed tab or a fully suspended background page). The
// deadline itself is persisted to localStorage so a *reload* of an open tab
// resumes correctly, and a deadline that already passed by the time the page
// is reopened fires immediately on load rather than silently vanishing —
// but a closed browser or OS-killed tab means no JS runs at all, so this
// switch is best-effort, not a guaranteed background service. Ceiling: true
// "fires even if the browser is fully closed" behavior needs a backend
// (e.g. a server-side scheduled job) or a persistent background service —
// out of scope for a static, backend-free app. Upgrade path: see the
// EMAILJS/Twilio notes in .env.example for what a backend would unlock here
// too (a server could hold the deadline and fire independently of the tab).
let tickInterval = null;
let currentDurationMs = null;

const WARN_FRACTION = 0.2; // start visually warning at 20% of duration remaining
const WARN_MAX_MS = 2 * 60 * 1000; // but never more than 2 minutes' warning window

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function setActiveUi(active) {
  checkinActiveArea.hidden = !active;
  checkinForm.hidden = active;
}

function stopTicking() {
  if (tickInterval !== null) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

async function handleCheckinElapsed() {
  stopTicking();
  clearCheckinState();
  setActiveUi(false);
  checkinStatus.textContent = "No check-in received — sending SOS automatically…";
  await sendSosAlert("checkin-timeout");
  // sendSosAlert() already wrote a specific outcome to #sos-status; reflect
  // it here too since this card has its own status line.
  checkinStatus.textContent = "Check-in timer elapsed — SOS alert triggered. See the SOS section above for send status.";
}

function tick() {
  const state = loadCheckinState();
  if (!state) {
    stopTicking();
    return;
  }
  const remaining = state.deadline - Date.now();
  if (remaining <= 0) {
    handleCheckinElapsed();
    return;
  }
  checkinCountdown.textContent = `Check in within ${formatRemaining(remaining)}`;
  const warnThreshold = Math.min(WARN_MAX_MS, state.durationMs * WARN_FRACTION);
  checkinActiveArea.classList.toggle("checkin-warning", remaining <= warnThreshold);
}

function startTicking() {
  stopTicking();
  tick();
  tickInterval = setInterval(tick, 1000);
}

function beginCheckin(durationMs) {
  const contact = loadContact();
  if (!contactIsValid(contact)) {
    checkinStatus.textContent = "Add a valid trusted contact above before starting a check-in timer.";
    return;
  }
  currentDurationMs = durationMs;
  const deadline = Date.now() + durationMs;
  saveCheckinState({ deadline, durationMs });
  setActiveUi(true);
  checkinActiveArea.classList.remove("checkin-warning");
  checkinStatus.textContent = "Check-in timer started.";
  startTicking();
}

checkinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  let minutes = parseInt(checkinMinutesInput.value, 10);
  if (!Number.isFinite(minutes)) minutes = 15;
  minutes = Math.min(180, Math.max(1, minutes));
  checkinMinutesInput.value = String(minutes);
  beginCheckin(minutes * 60 * 1000);
});

checkinSafeBtn.addEventListener("click", () => {
  const state = loadCheckinState();
  const durationMs = state ? state.durationMs : currentDurationMs;
  if (!durationMs) return;
  const deadline = Date.now() + durationMs;
  saveCheckinState({ deadline, durationMs });
  checkinActiveArea.classList.remove("checkin-warning");
  checkinStatus.textContent = `Checked in — timer reset to ${Math.round(durationMs / 60000)} min.`;
  tick();
});

checkinCancelBtn.addEventListener("click", () => {
  stopTicking();
  clearCheckinState();
  setActiveUi(false);
  checkinStatus.textContent = "Check-in timer canceled.";
});

// If a manual SOS or the chat detector already fired an alert while a
// check-in timer was running, the switch has done its job (help is already
// on the way) — stop it rather than risk a confusing second auto-fire
// later. Ignore our own "checkin-timeout" trigger (already handled above)
// and "canceled" (nothing was actually sent).
document.addEventListener("safetynet:sos-ended", (e) => {
  const detail = e.detail || {};
  if (detail.reason !== "fired" || detail.trigger === "checkin-timeout") return;
  const state = loadCheckinState();
  if (!state) return;
  stopTicking();
  clearCheckinState();
  setActiveUi(false);
  checkinStatus.textContent = "Check-in timer stopped — an SOS alert already went out.";
});

// ---------------------------------------------------------------------------
// Init — resume a timer that was running before a reload, or fire
// immediately (best-effort) if the deadline already passed while this tab
// wasn't open. See the ponytail note above tickInterval for the honest
// limits of this.
// ---------------------------------------------------------------------------

(function init() {
  const state = loadCheckinState();
  if (!state) return;
  currentDurationMs = state.durationMs;
  setActiveUi(true);
  if (state.deadline - Date.now() <= 0) {
    checkinStatus.textContent = "Check-in timer had already elapsed while this page was closed.";
    handleCheckinElapsed();
  } else {
    startTicking();
  }
})();

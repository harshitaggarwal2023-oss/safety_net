"use strict";

/*
 * Safety Net — sos.html page logic: contact status line, arm/countdown
 * state machine, and the new post-fire cooldown.
 *
 * Reuses (does not reimplement): contact-store.js's loadContact/
 * contactIsValid, and sos-engine.js's sendSosAlert() for the actual
 * "get location, build message, send" work. This file is only the SOS
 * button's own UI state machine (idle -> armed -> firing -> cooldown),
 * exactly the same state machine as the original Phase 1 app.js, plus one
 * new state.
 *
 * Same XSS discipline as the rest of the project: all dynamic text via
 * textContent, never innerHTML.
 */

const contactStatus = document.getElementById("contact-status");
const sosBtn = document.getElementById("sos-btn");
const sosBtnLabel = document.getElementById("sos-btn-label");
const countdownArea = document.getElementById("countdown-area");
const countdownText = document.getElementById("countdown-text");
const cancelBtn = document.getElementById("cancel-btn");
const sosStatus = document.getElementById("sos-status");
const cooldownNotice = document.getElementById("cooldown-notice");

function renderContactStatus() {
  const contact = loadContact();
  if (contact && contactIsValid(contact)) {
    const via = contact.email ? contact.email : contact.phone;
    contactStatus.textContent = `Trusted contact: ${contact.name} (${via})`;
  } else {
    contactStatus.textContent = "No valid trusted contact saved yet — set one up on the Home page before arming SOS.";
  }
  updateSosBtnEnabled();
}

// ---------------------------------------------------------------------------
// Arm / countdown state machine (unchanged from Phase 1)
// ---------------------------------------------------------------------------

const HOLD_MS = 700;
const DOUBLE_TAP_MS = 400;
const COUNTDOWN_S = 5;

// ponytail: client-side-only abuse/accident guard, not real server-side rate
// limiting (there is no server to enforce this against a malicious actor
// with multiple devices/browsers — see HANDOFF.md known-limitations). This
// purely stops one person's own device from mashing the button and spamming
// their trusted contact with repeat alerts, or from re-arming by accident
// seconds after a real fire/cancel. Ceiling & upgrade path documented in
// HANDOFF.md alongside the other client-side rate-limit notes.
const COOLDOWN_MS = 30 * 1000;

let holdTimer = null;
let lastTapAt = 0;
let countdownInterval = null;
let remainingSeconds = COUNTDOWN_S;
let state = "idle"; // idle | armed | firing | cooldown
let cooldownUntil = 0;
let cooldownInterval = null;

function setSosStatus(text) {
  sosStatus.textContent = text;
}

function updateSosBtnEnabled() {
  const contact = loadContact();
  const contactOk = contactIsValid(contact);
  sosBtn.disabled = !contactOk || state === "cooldown" || state === "firing";
  sosBtn.title = !contactOk ? "Add a trusted contact on the Home page first" : "";
}

function resetToIdle() {
  state = "idle";
  clearTimeout(holdTimer);
  clearInterval(countdownInterval);
  holdTimer = null;
  countdownInterval = null;
  remainingSeconds = COUNTDOWN_S;
  sosBtn.classList.remove("armed");
  sosBtn.setAttribute("aria-pressed", "false");
  sosBtnLabel.textContent = "SOS";
  countdownArea.hidden = true;
  updateSosBtnEnabled();
}

function startCooldown() {
  state = "cooldown";
  cooldownUntil = Date.now() + COOLDOWN_MS;
  sosBtn.classList.remove("armed");
  sosBtn.setAttribute("aria-pressed", "false");
  sosBtnLabel.textContent = "SOS";
  countdownArea.hidden = true;
  updateSosBtnEnabled();
  cooldownNotice.hidden = false;

  const tick = () => {
    const remainingMs = cooldownUntil - Date.now();
    if (remainingMs <= 0) {
      clearInterval(cooldownInterval);
      cooldownInterval = null;
      cooldownNotice.hidden = true;
      state = "idle";
      updateSosBtnEnabled();
      return;
    }
    cooldownNotice.textContent = `To prevent accidental repeat alerts, SOS can be armed again in ${Math.ceil(
      remainingMs / 1000
    )}s.`;
  };
  tick();
  cooldownInterval = setInterval(tick, 250);
}

function armAndStartCountdown() {
  if (state !== "idle") return;
  const contact = loadContact();
  if (!contactIsValid(contact)) {
    setSosStatus("Add a valid trusted contact on the Home page before arming SOS.");
    return;
  }

  state = "armed";
  sosBtn.classList.add("armed");
  sosBtn.setAttribute("aria-pressed", "true");
  sosBtnLabel.textContent = "ARMED";
  countdownArea.hidden = false;
  remainingSeconds = COUNTDOWN_S;
  countdownText.textContent = `Sending SOS in ${remainingSeconds}s`;
  setSosStatus("");

  countdownInterval = setInterval(() => {
    remainingSeconds -= 1;
    if (remainingSeconds <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      fireSos();
      return;
    }
    countdownText.textContent = `Sending SOS in ${remainingSeconds}s`;
  }, 1000);
}

cancelBtn.addEventListener("click", () => {
  resetToIdle();
  setSosStatus("SOS canceled.");
  // Use the shared broadcastSosEnded() (sos-engine.js), not a bare
  // document.dispatchEvent(), so this also reaches checkin.html/
  // history.html if they're open in ANOTHER tab — see sos-engine.js's
  // "Cross-page signal" comment for why a same-document CustomEvent alone
  // stopped being enough once SOS moved to its own page.
  broadcastSosEnded({ reason: "canceled" });
});

sosBtn.addEventListener("pointerdown", () => {
  if (sosBtn.disabled || state !== "idle") return;
  holdTimer = setTimeout(() => {
    holdTimer = null;
    armAndStartCountdown();
  }, HOLD_MS);
});

function clearHoldTimer() {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}

sosBtn.addEventListener("pointerup", () => {
  if (holdTimer) {
    clearHoldTimer();
    const now = Date.now();
    if (now - lastTapAt < DOUBLE_TAP_MS && state === "idle") {
      armAndStartCountdown();
      lastTapAt = 0;
    } else {
      lastTapAt = now;
    }
  }
});

sosBtn.addEventListener("pointerleave", clearHoldTimer);
sosBtn.addEventListener("pointercancel", clearHoldTimer);

async function fireSos() {
  state = "firing";
  sosBtnLabel.textContent = "SENDING…";
  countdownArea.hidden = true;
  updateSosBtnEnabled();

  await sendSosAlert("manual", { statusEl: sosStatus });

  startCooldown();
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

renderSosEngineWidget("sos-engine-mount");
// sos.html has its own #sos-status line (updated via the statusEl override
// passed to sendSosAlert() in fireSos() above) — hide the engine widget's
// generic status paragraph here so the result isn't shown twice. checkin.js
// and chat.js don't do this: they don't have their own status line for SOS
// outcomes, so they rely on the engine widget's default paragraph.
const engineDefaultStatus = document.getElementById("sos-engine-status");
if (engineDefaultStatus) engineDefaultStatus.hidden = true;
renderContactStatus();

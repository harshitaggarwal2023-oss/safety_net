"use strict";

/*
 * Safety Net — Phase 1: SOS Alert
 *
 * Everything here uses `textContent` (never `innerHTML`) to put user-provided
 * strings into the DOM, and every outbound link (mailto:/sms:) is built with
 * encodeURIComponent(). That's the whole XSS defense: untrusted strings never
 * get parsed as HTML.
 */

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const STORAGE_KEY = "safetyNet.trustedContact";

function loadContact() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (err) {
    console.warn("Safety Net: couldn't read saved contact, ignoring.", err);
    return null;
  }
}

function saveContact(contact) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contact));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value) {
  return EMAIL_RE.test(value.trim());
}

function isValidPhone(value) {
  const digits = value.replace(/[^0-9]/g, "");
  // ponytail: a real phone-validation library (e.g. libphonenumber) would
  // catch more malformed numbers correctly across countries. Ceiling: this
  // only checks digit count (7-15) after stripping formatting characters.
  // Upgrade path: swap this function for libphonenumber-js if phone-based
  // sending becomes a primary path rather than a fallback.
  return digits.length >= 7 && digits.length <= 15;
}

function contactIsValid(contact) {
  if (!contact || !contact.name || !contact.name.trim()) return false;
  const hasEmail = !!contact.email && contact.email.trim().length > 0;
  const hasPhone = !!contact.phone && contact.phone.trim().length > 0;
  if (!hasEmail && !hasPhone) return false;
  if (hasEmail && !isValidEmail(contact.email)) return false;
  if (hasPhone && !isValidPhone(contact.phone)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const contactForm = document.getElementById("contact-form");
const nameInput = document.getElementById("contact-name");
const emailInput = document.getElementById("contact-email");
const phoneInput = document.getElementById("contact-phone");
const emailError = document.getElementById("email-error");
const phoneError = document.getElementById("phone-error");
const contactStatus = document.getElementById("contact-status");

const sosBtn = document.getElementById("sos-btn");
const sosBtnLabel = document.getElementById("sos-btn-label");
const countdownArea = document.getElementById("countdown-area");
const countdownText = document.getElementById("countdown-text");
const cancelBtn = document.getElementById("cancel-btn");
const sosStatus = document.getElementById("sos-status");

const manualLocationCard = document.getElementById("manual-location-card");
const manualLocationForm = document.getElementById("manual-location-form");
const manualLocationInput = document.getElementById("manual-location-input");

const messageCard = document.getElementById("message-card");
const messagePreview = document.getElementById("message-preview");
const copyBtn = document.getElementById("copy-btn");
const copyStatus = document.getElementById("copy-status");

// ---------------------------------------------------------------------------
// Contact form
// ---------------------------------------------------------------------------

function renderContactStatus() {
  const contact = loadContact();
  if (contact && contactIsValid(contact)) {
    const via = contact.email ? contact.email : contact.phone;
    contactStatus.textContent = `Saved: ${contact.name} (${via})`;
    sosBtn.disabled = false;
    sosBtn.title = "";
  } else {
    contactStatus.textContent = "No valid trusted contact saved yet — SOS is disabled until you add one.";
    sosBtn.disabled = true;
    sosBtn.title = "Add a trusted contact first";
  }
}

contactForm.addEventListener("submit", (e) => {
  e.preventDefault();
  emailError.hidden = true;
  phoneError.hidden = true;

  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const phone = phoneInput.value.trim();

  let ok = true;

  if (!name) {
    ok = false;
  }
  if (email && !isValidEmail(email)) {
    emailError.textContent = "That doesn't look like a valid email address.";
    emailError.hidden = false;
    ok = false;
  }
  if (phone && !isValidPhone(phone)) {
    phoneError.textContent = "That doesn't look like a valid phone number (need 7-15 digits).";
    phoneError.hidden = false;
    ok = false;
  }
  if (!email && !phone) {
    emailError.textContent = "Add at least an email or a phone number.";
    emailError.hidden = false;
    ok = false;
  }

  if (!ok) return;

  saveContact({ name, email, phone });
  renderContactStatus();
});

renderContactStatus();

// ---------------------------------------------------------------------------
// Arm / countdown state machine
// ---------------------------------------------------------------------------

const HOLD_MS = 700;      // press-and-hold duration to arm
const DOUBLE_TAP_MS = 400; // max gap between taps to count as double-tap
const COUNTDOWN_S = 5;

let holdTimer = null;
let lastTapAt = 0;
let countdownInterval = null;
let remainingSeconds = COUNTDOWN_S;
let state = "idle"; // idle | armed | firing

function setSosStatus(text) {
  sosStatus.textContent = text;
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
}

function armAndStartCountdown() {
  if (state !== "idle") return;
  const contact = loadContact();
  if (!contactIsValid(contact)) {
    setSosStatus("Add a valid trusted contact before arming SOS.");
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
  // Let other modules (route.js's opt-in tracking) react without app.js
  // needing to know they exist — reuse via event, not a new global coupling.
  document.dispatchEvent(new CustomEvent("safetynet:sos-ended", { detail: { reason: "canceled" } }));
});

// Press-and-hold to arm
sosBtn.addEventListener("pointerdown", (e) => {
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
  // If the hold timer already fired, armAndStartCountdown() has run; nothing more to do.
  if (holdTimer) {
    clearHoldTimer();
    // Treat as a tap for double-tap detection.
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

// ---------------------------------------------------------------------------
// Geolocation (with manual fallback)
// ---------------------------------------------------------------------------

let pendingManualResolve = null;

function getLocationOrFallback() {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      setSosStatus("Your browser doesn't support location — please enter it manually.");
      showManualLocationForm(resolve);
      return;
    }

    setSosStatus("Getting your location…");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          type: "coords",
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        // Denied, timed out, or position unavailable — never fail silently.
        console.warn("Safety Net: geolocation failed, falling back to manual entry.", error);
        setSosStatus("Couldn't get your location automatically — please enter it manually.");
        showManualLocationForm(resolve);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}

function showManualLocationForm(resolve) {
  pendingManualResolve = resolve;
  manualLocationCard.hidden = false;
  manualLocationInput.focus();
}

manualLocationForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = manualLocationInput.value.trim();
  if (!text || !pendingManualResolve) return;
  manualLocationCard.hidden = true;
  const resolve = pendingManualResolve;
  pendingManualResolve = null;
  manualLocationInput.value = "";
  resolve({ type: "manual", text });
});

// ---------------------------------------------------------------------------
// Build + send the alert
// ---------------------------------------------------------------------------

function buildMapsLink(lat, lng) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

// Human-readable framing per trigger source, so the person receiving the
// alert knows *why* it fired, not just that it did. Keyed by the same
// triggerReason strings passed to sendSosAlert().
const TRIGGER_MESSAGES = {
  manual: "This is an automated safety alert. The sender may need help.",
  "checkin-timeout":
    "This is an automated safety alert: the sender set a check-in timer in Safety Net and did not tap \"I'm safe\" before it ran out.",
  "chat-detector":
    "This is an automated safety alert: the sender's Safety Net chat check-in flagged possible distress, and the sender confirmed sending this alert.",
};

function buildMessage(contact, location, triggerReason) {
  const lines = [
    `SOS ALERT from Safety Net`,
    `${contact.name ? "For: " + contact.name : ""}`.trim(),
    "",
    TRIGGER_MESSAGES[triggerReason] || TRIGGER_MESSAGES.manual,
    "",
  ];

  if (location.type === "coords") {
    lines.push(`Live location: ${buildMapsLink(location.lat, location.lng)}`);
    lines.push(`Coordinates: ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`);
  } else {
    lines.push(`Reported location (manually entered): ${location.text}`);
  }

  lines.push("");
  lines.push(`Sent: ${new Date().toLocaleString()}`);

  return lines.filter((l) => l !== "").join("\n");
}

async function sendViaEmailJS(config, contact, subject, body) {
  const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: config.EMAILJS_SERVICE_ID,
      template_id: config.EMAILJS_TEMPLATE_ID,
      user_id: config.EMAILJS_PUBLIC_KEY,
      template_params: {
        to_email: contact.email,
        to_name: contact.name,
        subject,
        message: body,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`EmailJS responded with ${res.status}`);
  }
}

function openMailto(contact, subject, body) {
  const link = `mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
  window.location.href = link;
}

function openSms(contact, body) {
  // ponytail: `sms:` link formatting for pre-filled body isn't fully
  // standardized across OSes (iOS wants `&body=`, some Android/desktop
  // browsers ignore it entirely). Ceiling: body may not pre-fill everywhere.
  // Upgrade path: Twilio (or another SMS API) behind a small backend, see
  // .env.example, once this project has a server component.
  const link = `sms:${encodeURIComponent(contact.phone)}?&body=${encodeURIComponent(body)}`;
  window.location.href = link;
}

function showMessagePreview(text) {
  messagePreview.textContent = text;
  messageCard.hidden = false;
}

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(messagePreview.textContent);
    copyStatus.textContent = "Copied!";
  } catch (err) {
    copyStatus.textContent = "Couldn't copy automatically — select the text above and copy manually.";
  }
});

// ---------------------------------------------------------------------------
// sendSosAlert() — the actual "get location, build message, send it" core.
// Reused (not rebuilt) by every trigger path: the manual arm/countdown flow
// below, the Phase 3 check-in dead-man's switch (checkin.js), and the Phase
// 3 chat distress detector (chat.js). None of those files fork or duplicate
// this logic — they all just call sendSosAlert(triggerReason) directly.
// It has no dependency on the arm/countdown UI beyond the shared status/
// message-preview elements every trigger path also wants to show.
// ---------------------------------------------------------------------------

async function sendSosAlert(triggerReason) {
  const contact = loadContact();
  if (!contactIsValid(contact)) {
    setSosStatus("No valid trusted contact — SOS aborted.");
    return { sent: false };
  }

  const location = await getLocationOrFallback();
  const subject = "SOS Alert — please check on me";
  const body = buildMessage(contact, location, triggerReason);

  showMessagePreview(body);

  const envConfig = typeof window !== "undefined" ? window.SAFETY_NET_ENV : null;
  const emailJsConfigured =
    envConfig &&
    envConfig.EMAILJS_SERVICE_ID &&
    envConfig.EMAILJS_TEMPLATE_ID &&
    envConfig.EMAILJS_PUBLIC_KEY &&
    contact.email;

  try {
    if (emailJsConfigured) {
      await sendViaEmailJS(envConfig, contact, subject, body);
      setSosStatus(`SOS sent to ${contact.name} via email.`);
    } else if (contact.email) {
      openMailto(contact, subject, body);
      setSosStatus(`Opening your email app to send the alert to ${contact.name}.`);
    } else if (contact.phone) {
      openSms(contact, body);
      setSosStatus(`Opening your messaging app to send the alert to ${contact.name}.`);
    } else {
      setSosStatus("No send method available — copy the message below and send it yourself.");
    }
  } catch (err) {
    console.error("Safety Net: send failed, message is still available to copy.", err);
    setSosStatus("Automatic send failed — copy the message below and send it yourself.");
  }

  // See note on the cancel-btn listener above: lets route.js auto-stop
  // opt-in tracking, and (Phase 3) checkin.js retire an active check-in
  // switch, once an SOS has actually fired/resolved — without any of those
  // files depending directly on each other.
  document.dispatchEvent(
    new CustomEvent("safetynet:sos-ended", { detail: { reason: "fired", trigger: triggerReason } })
  );
  return { sent: true };
}

async function fireSos() {
  state = "firing";
  sosBtnLabel.textContent = "SENDING…";
  countdownArea.hidden = true;

  await sendSosAlert("manual");

  resetToIdle();
}

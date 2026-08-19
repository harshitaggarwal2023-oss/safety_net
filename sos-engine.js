"use strict";

/*
 * Safety Net — shared SOS send pipeline (sendSosAlert()).
 *
 * This is the Phase 3 refactor's `sendSosAlert(triggerReason)` from the old
 * single-page app.js, moved into its own file so it can be included by
 * every page that can trigger an SOS: sos.html (manual arm/countdown),
 * checkin.html (dead-man's-switch timeout), and chat.html (distress
 * detector confirm). The function's BODY is unchanged from the Phase 3
 * handoff — get contact, get location (with manual fallback), build
 * message, send, dispatch `safetynet:sos-ended`. The only change made for
 * the multi-page restructure is that the status line and the manual-
 * location/message-preview UI are now built once by renderSosEngineWidget()
 * and injected into a placeholder <div> on whichever page needs them,
 * instead of living permanently in one big index.html. Same XSS discipline
 * throughout: every dynamic string reaches the DOM via textContent, never
 * innerHTML.
 *
 * Depends on contact-store.js being loaded first (loadContact/contactIsValid).
 */

// ---------------------------------------------------------------------------
// Widget: manual-location fallback + message preview + status line.
// Built with DOM APIs (createElement/textContent), never innerHTML, so this
// injection point can never become a place where unescaped input reaches
// the DOM as markup.
// ---------------------------------------------------------------------------

let manualLocationCard, manualLocationForm, manualLocationInput;
let messageCard, messagePreview, copyBtn, copyStatus;
let defaultStatusEl;
let pendingManualResolve = null;

function el(tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === "textContent") node.textContent = v;
      else if (k === "className") node.className = v;
      else node.setAttribute(k, v);
    }
  }
  (children || []).forEach((c) => node.appendChild(c));
  return node;
}

function renderSosEngineWidget(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Manual location fallback card (hidden until geolocation fails).
  manualLocationInput = el("input", {
    id: "manual-location-input",
    type: "text",
    maxlength: "200",
    placeholder: "e.g. Near 5th & Main, outside the coffee shop",
    required: "required",
  });
  const manualSubmitBtn = el("button", {
    className: "btn btn-primary",
    type: "submit",
    textContent: "Send SOS with this location",
  });
  manualLocationForm = el("form", { id: "manual-location-form", novalidate: "novalidate" }, [
    el("label", { for: "manual-location-input", textContent: "Your location" }),
    manualLocationInput,
    manualSubmitBtn,
  ]);
  manualLocationCard = el(
    "section",
    { className: "card", id: "manual-location-card", hidden: "hidden", "aria-labelledby": "manual-location-heading" },
    [
      el("h2", { id: "manual-location-heading", textContent: "Location access denied or unavailable" }),
      el("p", { className: "hint", textContent: "No problem — describe where you are and we'll include that in the alert instead." }),
      manualLocationForm,
    ]
  );

  // Message preview / manual send card (hidden until a send is attempted).
  messagePreview = el("pre", { id: "message-preview", className: "message-preview" });
  copyBtn = el("button", { id: "copy-btn", className: "btn btn-secondary", type: "button", textContent: "Copy message" });
  copyStatus = el("p", { id: "copy-status", className: "copy-status", "aria-live": "polite" });
  messageCard = el(
    "section",
    { className: "card", id: "message-card", hidden: "hidden", "aria-labelledby": "message-heading" },
    [
      el("h2", { id: "message-heading", textContent: "Alert message" }),
      el("p", { className: "hint", textContent: "This is the alert. If the automatic send didn't open your mail/messaging app, copy it and send it yourself." }),
      messagePreview,
      copyBtn,
      copyStatus,
    ]
  );

  defaultStatusEl = el("p", { id: "sos-engine-status", className: "sos-status", "aria-live": "polite" });

  container.append(manualLocationCard, messageCard, defaultStatusEl);

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

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(messagePreview.textContent);
      copyStatus.textContent = "Copied!";
    } catch (err) {
      copyStatus.textContent = "Couldn't copy automatically — select the text above and copy manually.";
    }
  });
}

// ---------------------------------------------------------------------------
// Geolocation (with manual fallback) — unchanged from Phase 1/3.
// ---------------------------------------------------------------------------

function setEngineStatus(text, statusEl) {
  (statusEl || defaultStatusEl).textContent = text;
}

function getLocationOrFallback(statusEl) {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      setEngineStatus("Your browser doesn't support location — please enter it manually.", statusEl);
      showManualLocationForm(resolve);
      return;
    }

    setEngineStatus("Getting your location…", statusEl);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          type: "coords",
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        console.warn("Safety Net: geolocation failed, falling back to manual entry.", error);
        setEngineStatus("Couldn't get your location automatically — please enter it manually.", statusEl);
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

// ---------------------------------------------------------------------------
// Build + send the alert — unchanged logic from the Phase 3 handoff.
// ---------------------------------------------------------------------------

function buildMapsLink(lat, lng) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

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

// ---------------------------------------------------------------------------
// sendSosAlert() — the actual "get location, build message, send it" core.
// Reused (not rebuilt) by every trigger path: sos-page.js's arm/countdown
// flow, checkin.js's dead-man's switch, and chat.js's distress detector.
// None of those files fork or duplicate this logic — they all just call
// sendSosAlert(triggerReason, { statusEl }) directly. `statusEl` is the one
// parameter added for the multi-page split: each page passes the status
// element it wants the result text written to (sos.html reuses its own
// arm-flow status line; checkin.html/chat.html fall back to the widget's
// own #sos-engine-status paragraph). No other behavior changed.
// ---------------------------------------------------------------------------

async function sendSosAlert(triggerReason, opts) {
  const statusEl = (opts && opts.statusEl) || defaultStatusEl;
  const contact = loadContact();
  if (!contactIsValid(contact)) {
    setEngineStatus("No valid trusted contact — SOS aborted.", statusEl);
    return { sent: false };
  }

  const location = await getLocationOrFallback(statusEl);
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
      setEngineStatus(`SOS sent to ${contact.name} via email.`, statusEl);
    } else if (contact.email) {
      openMailto(contact, subject, body);
      setEngineStatus(`Opening your email app to send the alert to ${contact.name}.`, statusEl);
    } else if (contact.phone) {
      openSms(contact, body);
      setEngineStatus(`Opening your messaging app to send the alert to ${contact.name}.`, statusEl);
    } else {
      setEngineStatus("No send method available — copy the message below and send it yourself.", statusEl);
    }
  } catch (err) {
    console.error("Safety Net: send failed, message is still available to copy.", err);
    setEngineStatus("Automatic send failed — copy the message below and send it yourself.", statusEl);
  }

  // Lets route-history.js auto-stop opt-in tracking, and checkin.js retire
  // an active check-in switch, once an SOS has actually fired/resolved —
  // without any of those files depending directly on each other.
  broadcastSosEnded({ reason: "fired", trigger: triggerReason });
  return { sent: true };
}

// ---------------------------------------------------------------------------
// Cross-page signal — NEW for the Phase 4 multi-page restructure.
//
// In the old single-page app, SOS/check-in/chat/tracking were all sections
// of ONE document, so a plain `document.dispatchEvent(CustomEvent(...))`
// reached every listener instantly. Now that SOS lives on its own page
// (sos.html) while an active check-in timer or an active tracking session
// can be open on a DIFFERENT page (checkin.html / history.html) — possibly
// in a different browser tab — a same-document CustomEvent from sos.html
// never reaches those other pages' listeners at all.
//
// The fix: also persist the same event detail to a small localStorage key.
// Writing to localStorage fires a native `storage` event in every OTHER
// open tab/page of this origin (never the tab that wrote it), which is
// exactly the cross-tab signal checkin.js and route-history.js need to
// keep their "auto-cancel/auto-stop when an SOS ends elsewhere" behavior
// working. This is still 100% client-side/on-device — nothing here is
// transmitted off the browser, same as every other localStorage use in
// this project.
// ---------------------------------------------------------------------------

const SOS_ENDED_SIGNAL_KEY = "safetyNet.sosEndedSignal";

// checkin.js and route-history.js call this once on load instead of adding
// their own `document.addEventListener("safetynet:sos-ended", ...)` — it
// wires up BOTH the same-tab CustomEvent (in case this page itself is what
// called sendSosAlert()) and the cross-tab `storage` event (in case SOS
// fired from sos.html in a different tab), so callers get one consistent
// callback regardless of which tab the alert actually fired from.
function onSosEnded(callback) {
  document.addEventListener("safetynet:sos-ended", (e) => callback(e.detail || {}));
  window.addEventListener("storage", (e) => {
    if (e.key !== SOS_ENDED_SIGNAL_KEY || !e.newValue) return;
    try {
      callback(JSON.parse(e.newValue));
    } catch (err) {
      console.warn("Safety Net: couldn't parse cross-tab SOS-ended signal.", err);
    }
  });
}

function broadcastSosEnded(detail) {
  // Same-document listeners (a page reacting to its own sendSosAlert() call,
  // e.g. checkin.js retiring the timer that just fired) still get the fast
  // in-memory CustomEvent path, unchanged from Phase 3.
  document.dispatchEvent(new CustomEvent("safetynet:sos-ended", { detail }));
  try {
    localStorage.setItem(SOS_ENDED_SIGNAL_KEY, JSON.stringify({ ...detail, at: Date.now() }));
  } catch (err) {
    console.warn("Safety Net: couldn't broadcast SOS-ended signal to other tabs.", err);
  }
}

"use strict";

/*
 * Safety Net — Phase 3b: Chat distress detector
 *
 * Entirely client-side keyword/pattern matching over text the user types —
 * no network call, no server, nothing stored. This is a deliberate design
 * choice (see HANDOFF.md): the project has stayed backend-free through two
 * phases, and a "send typed text to a server for analysis" feature would be
 * a much bigger call than this session should make unilaterally.
 *
 * ponytail: this is a small hand-authored keyword/phrase list, not a real
 * NLP classifier — it will miss paraphrased distress and can false-positive
 * on unrelated text (e.g. "that movie's ending scared me"). Ceiling: no
 * understanding of context, negation, or sarcasm. Upgrade path: a proper
 * on-device text classifier (e.g. a small local model) if false positive/
 * negative rates matter beyond a hackathon demo — see the disclaimer
 * shown in the UI (#chat-disclaimer), which says exactly this.
 *
 * Because a naive keyword scanner *will* misfire sometimes, this never
 * auto-sends an alert the way the check-in dead-man's switch does. A flagged
 * message always shows an inline confirm/dismiss prompt first — the SOS
 * pipeline only actually reuses sendSosAlert() if the user taps "Send SOS
 * now". That's the deliberate difference from 3a: a missed check-in means
 * the user *couldn't* respond, so auto-firing is the point; typed text is
 * noisy, so a confirmation gate avoids alert fatigue and false alarms.
 *
 * Same DOM-safety discipline as app.js/route.js: every piece of user-typed
 * or generated text reaches the DOM via textContent, never innerHTML.
 */

// ---------------------------------------------------------------------------
// Detection — plain-language phrases about being unsafe, followed, trapped,
// or hurt. Scoped to the app's actual purpose (personal physical safety),
// not a general mental-health crisis classifier — see the UI disclaimer for
// what to do if this isn't the right kind of help.
// ---------------------------------------------------------------------------

const DISTRESS_PHRASES = [
  "help me",
  "i need help",
  "please help",
  "send help",
  "im in danger",
  "in danger",
  "someone is following me",
  "im being followed",
  "being followed",
  "hes following me",
  "shes following me",
  "theyre following me",
  "dont feel safe",
  "i feel unsafe",
  "im not safe",
  "not safe here",
  "call the police",
  "call 911",
  "im scared",
  "im really scared",
  "wont let me leave",
  "cant get away",
  "cant leave",
  "im trapped",
  "hes hurting me",
  "shes hurting me",
  "theyre hurting me",
  "hurting me",
  "he hit me",
  "she hit me",
  "come get me now",
  "this is an emergency",
];

function normalizeForMatch(text) {
  return text.toLowerCase().replace(/['’]/g, "");
}

const DISTRESS_PATTERNS = DISTRESS_PHRASES.map((phrase) => {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped.replace(/ /g, "\\s+")}\\b`, "i");
});

function detectDistress(text) {
  const normalized = normalizeForMatch(text);
  return DISTRESS_PATTERNS.some((re) => re.test(normalized));
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");

// ---------------------------------------------------------------------------
// Rendering helpers — textContent only, per project-wide XSS discipline.
// ---------------------------------------------------------------------------

function appendUserMessage(text) {
  const div = document.createElement("div");
  div.className = "chat-msg chat-msg-user";
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function appendSystemMessage(text, { flag = false } = {}) {
  const div = document.createElement("div");
  div.className = flag ? "chat-msg chat-msg-system chat-msg-flag" : "chat-msg chat-msg-system";
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

function appendConfirmPrompt() {
  const wrap = appendSystemMessage(
    "That sounds like it could be a safety concern. Send an SOS alert to your trusted contact now?",
    { flag: true }
  );

  const row = document.createElement("div");
  row.className = "chat-confirm-row";

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.className = "btn btn-cancel btn-small";
  sendBtn.textContent = "Send SOS now";

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "btn btn-secondary btn-small";
  dismissBtn.textContent = "No, I'm okay";

  sendBtn.addEventListener("click", async () => {
    sendBtn.disabled = true;
    dismissBtn.disabled = true;
    appendSystemMessage("Sending SOS…");
    await sendSosAlert("chat-detector");
    appendSystemMessage("SOS triggered — see the SOS section above for send status.");
  });

  dismissBtn.addEventListener("click", () => {
    sendBtn.disabled = true;
    dismissBtn.disabled = true;
    appendSystemMessage("OK — no alert sent.");
  });

  row.append(sendBtn, dismissBtn);
  wrap.appendChild(row);
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  appendUserMessage(text);
  chatInput.value = "";

  if (detectDistress(text)) {
    appendConfirmPrompt();
  }

  chatInput.focus();
});

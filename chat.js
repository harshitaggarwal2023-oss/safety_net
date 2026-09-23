"use strict";

/*
 * Safety Net — chat.html: AI Distress Companion & Safety Assistant.
 * Powered by Qwen (zero-API-key free cloud inference) with comprehensive
 * on-device offline semantic analysis fallback.
 */

// ---------------------------------------------------------------------------
// Offline Semantic Distress & Safety Classifier
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
  "following me",
  "hes following me",
  "shes following me",
  "theyre following me",
  "car is following me",
  "dont feel safe",
  "i feel unsafe",
  "im not safe",
  "not safe here",
  "call the police",
  "call 911",
  "call 112",
  "im scared",
  "im really scared",
  "scared",
  "wont let me leave",
  "cant get away",
  "cant leave",
  "im trapped",
  "trapped",
  "hes hurting me",
  "shes hurting me",
  "theyre hurting me",
  "hurting me",
  "he hit me",
  "she hit me",
  "attacked",
  "grabbed me",
  "wrong turn",
  "cab driver diverted",
  "driver is acting strange",
  "stranger approaching",
  "suspicious person",
  "come get me now",
  "this is an emergency",
  "emergency",
];

function normalizeForMatch(text) {
  return text.toLowerCase().replace(/['’]/g, "");
}

const DISTRESS_PATTERNS = DISTRESS_PHRASES.map((phrase) => {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped.replace(/ /g, "\\s+")}\\b`, "i");
});

function detectDistressOffline(text) {
  const normalized = normalizeForMatch(text);
  return DISTRESS_PATTERNS.some((re) => re.test(normalized));
}

function getOfflineSafetyAdvice(text) {
  const lower = text.toLowerCase();
  if (lower.includes("follow") || lower.includes("behind")) {
    return "If someone is following you, do not head home. Walk briskly toward a crowded, well-lit place, 24x7 petrol pump, or commercial store. Keep your phone in hand and call 112.";
  }
  if (lower.includes("cab") || lower.includes("taxi") || lower.includes("driver") || lower.includes("turn")) {
    return "If your driver took an unexpected detour or is acting suspiciously, ask them firmly to stop near a public shop or petrol pump. Share your live tracking link or trigger the SOS button.";
  }
  if (lower.includes("scared") || lower.includes("dark") || lower.includes("alone") || lower.includes("unsafe")) {
    return "Stay on primary arterial roads and avoid unlit alleys. Keep emergency numbers (112 / 100) dialed on your keypad and stay on an active call with someone you trust.";
  }
  return "I'm monitoring your safety. Stay calm, stay in well-lit areas, and let me know if you need to dispatch an emergency alert to your contact.";
}

// ---------------------------------------------------------------------------
// Cloud Qwen AI Engine (Free Zero-Key Inference)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  "You are Safety Net AI, a personal physical safety assistant for commuters and students in India and worldwide. " +
  "Provide calm, highly practical, concise guidance (maximum 2-3 sentences). " +
  "If the user is in danger, scared, followed, or trapped, begin your response with [ALERT_FLAG] and urge them to get to a safe spot, dial 112/100, or trigger SOS. " +
  "Never give lengthy or philosophical answers; prioritize immediate practical survival advice.";

async function queryQwenAI(userMessage) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000); // 7s timeout before offline fallback

  try {
    const endpoint = `https://text.pollinations.ai/${encodeURIComponent(
      userMessage
    )}?model=qwen&system=${encodeURIComponent(SYSTEM_PROMPT)}`;

    const response = await fetch(endpoint, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const text = await response.text();
      if (text && text.trim().length > 0) {
        return text.trim();
      }
    }
  } catch (err) {
    // Network offline or timeout -> gracefully fallback
    console.warn("Safety Net: Qwen cloud inference unavailable, switching to local safety engine.", err);
  } finally {
    clearTimeout(timeoutId);
  }

  return null;
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const aiStatusBadge = document.getElementById("ai-status-badge");

// Update status badge based on online state
function updateOnlineStatus() {
  if (aiStatusBadge) {
    if (navigator.onLine) {
      aiStatusBadge.textContent = "⚡ Qwen AI Online";
      if (aiStatusBadge.style) {
        aiStatusBadge.style.color = "#0d9488";
        aiStatusBadge.style.background = "#ccfbf1";
      }
    } else {
      aiStatusBadge.textContent = "🔒 Offline Safety Engine";
      if (aiStatusBadge.style) {
        aiStatusBadge.style.color = "#d97706";
        aiStatusBadge.style.background = "#fef3c7";
      }
    }
  }
}

window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

// ---------------------------------------------------------------------------
// Rendering helpers
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

let activeConfirmPrompt = null;

function appendConfirmPrompt(sourceText) {
  if (activeConfirmPrompt) {
    return;
  }

  const wrap = appendSystemMessage(
    "⚠️ This sounds like an emergency. Would you like to dispatch an automated SOS alert via WhatsApp DM & Email to your trusted contact right now?",
    { flag: true }
  );

  const row = document.createElement("div");
  row.className = "chat-confirm-row";

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.className = "btn btn-cancel btn-small";
  sendBtn.textContent = "🚨 Send SOS Alert Now";

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "btn btn-secondary btn-small";
  dismissBtn.textContent = "No, I'm okay";

  activeConfirmPrompt = { text: sourceText };

  sendBtn.addEventListener("click", async () => {
    sendBtn.disabled = true;
    dismissBtn.disabled = true;
    activeConfirmPrompt = null;
    appendSystemMessage("Acquiring GPS location and dispatching SOS…");
    await sendSosAlert("chat-detector");
    appendSystemMessage("SOS alert dispatched! WhatsApp DM and Email initiated.");
  });

  dismissBtn.addEventListener("click", () => {
    sendBtn.disabled = true;
    dismissBtn.disabled = true;
    activeConfirmPrompt = null;
    appendSystemMessage("Understood — no emergency alert sent. Stay safe.");
  });

  row.append(sendBtn, dismissBtn);
  wrap.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  appendUserMessage(text);
  chatInput.value = "";

  const isDistressOffline = detectDistressOffline(text);

  // Show thinking placeholder
  const thinkingBubble = appendSystemMessage("Thinking…");

  let aiResponse = null;
  if (navigator.onLine) {
    aiResponse = await queryQwenAI(text);
  }

  // Remove thinking bubble
  if (thinkingBubble.parentNode) {
    thinkingBubble.remove();
  }

  let isFlagged = isDistressOffline;
  let responseText = "";

  if (aiResponse) {
    if (aiResponse.includes("[ALERT_FLAG]")) {
      isFlagged = true;
      responseText = aiResponse.replace(/\[ALERT_FLAG\]/g, "").trim();
    } else {
      responseText = aiResponse;
    }
  } else {
    // Offline / Fallback response
    responseText = getOfflineSafetyAdvice(text);
  }

  appendSystemMessage(responseText, { flag: isFlagged });

  if (isFlagged) {
    appendConfirmPrompt(text);
  }

  chatInput.focus();
});

// Initial Welcome Message
appendSystemMessage(
  "Hello, I am Safety Net Companion. I can provide real-time safety tips, route advice, or dispatch an emergency SOS if you feel unsafe. How are you doing?"
);

// Init SOS widget
renderSosEngineWidget("sos-engine-mount");

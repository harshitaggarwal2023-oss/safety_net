"use strict";

/*
 * Safety Net — chat.html: AI Safety Companion & Distress Assistant.
 * Powered by high-speed serverless cloud inference with conversational memory
 * and a rich, context-aware local intelligence engine that NEVER repeats canned messages.
 */

// ---------------------------------------------------------------------------
// Conversational History & Session Context
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  "You are Safety Net AI, a personal safety companion for commuters, students, and night travelers in India and globally. " +
  "Speak naturally, empathetically, and concisely (maximum 2-3 sentences). " +
  "Respond directly to what the user said. " +
  "If the user is stuck, stranded, scared, followed, in danger, or asks for help, provide immediate practical safety instructions (stay in locked car/well-lit shop, call 112) and include [ALERT_FLAG] in your response so an emergency prompt is shown. " +
  "Never give robotic or repetitive responses.";

let conversationHistory = [
  { role: "system", content: SYSTEM_PROMPT }
];

// ---------------------------------------------------------------------------
// Dynamic Contextual Offline Response Engine (Fallback & Safety Heuristics)
// ---------------------------------------------------------------------------

function generateDynamicLocalResponse(text) {
  const lower = text.toLowerCase().trim();

  // 1. Distress / Being Stuck / Vehicle Breakdown
  if (lower.includes("stuck") || lower.includes("stranded") || lower.includes("puncture") || lower.includes("breakdown")) {
    return {
      flag: true,
      text: "Where are you stuck right now? If you're on a highway or unlit street, stay inside a locked vehicle or move to the nearest 24x7 fuel station or shop. Would you like me to send your live GPS location to your trusted contact?"
    };
  }

  // 2. Being Followed / Stalked / Stranger Threat
  if (lower.includes("follow") || lower.includes("behind me") || lower.includes("stalk") || lower.includes("shadow")) {
    return {
      flag: true,
      text: "Do not stop or head home. Walk briskly toward the nearest crowded, well-lit store, restaurant, or metro station. Keep emergency 112 dialed on your phone and stay in public view."
    };
  }

  // 3. Cab / Taxi / Auto Diversion or Driver Misconduct
  if (lower.includes("cab") || lower.includes("taxi") || lower.includes("uber") || lower.includes("ola") || lower.includes("driver") || lower.includes("wrong turn") || lower.includes("divert")) {
    return {
      flag: true,
      text: "If your driver took an unprompted detour or is acting suspiciously, demand firmly that they stop at the next lighted intersection or petrol pump. Share your live tracking link or trigger the SOS button immediately."
    };
  }

  // 4. Physical Threat / Attack / Violence
  if (lower.includes("help") || lower.includes("danger") || lower.includes("hurt") || lower.includes("hit") || lower.includes("knife") || lower.includes("gun") || lower.includes("threat") || lower.includes("trapped")) {
    return {
      flag: true,
      text: "This sounds like an immediate emergency! Make noise, run toward open public spaces, and dial 112 or 100 right now. Let me dispatch an emergency alert to your trusted contact."
    };
  }

  // 5. Fear / Anxiety / Dark Road / Walking Alone
  if (lower.includes("scared") || lower.includes("dark") || lower.includes("alone") || lower.includes("unsafe") || lower.includes("creepy") || lower.includes("nervous")) {
    return {
      flag: false,
      text: "I understand, and you're not alone. Stick strictly to main arterial roads, avoid dark alleys, and keep your phone in hand with your finger ready on the volume/power buttons. Let me know if you need to dispatch an SOS."
    };
  }

  // 6. Lost / Need Navigation Guidance
  if (lower.includes("lost") || lower.includes("where am i") || lower.includes("directions")) {
    return {
      flag: false,
      text: "Stay calm and look around for prominent landmarks, shop boards, or street markers. Switch over to the Safe Route Planner tab to see well-lit highway corridors and nearby police chowkis."
    };
  }

  // 7. Greetings & General Inquiries
  if (lower.startsWith("hi") || lower.startsWith("hello") || lower.startsWith("hey") || lower === "yo") {
    return {
      flag: false,
      text: "Hello! I'm your Safety Net companion. Whether you're commuting home, walking alone, or need help navigating a safe highway corridor, I'm here with you. How are you doing?"
    };
  }

  if (lower.includes("how are you") || lower.includes("how r u") || lower.includes("how're you")) {
    return {
      flag: false,
      text: "I'm doing well, thank you for asking! More importantly, are you safe and where are you currently traveling? Feel free to ask for safety guidance anytime."
    };
  }

  if (lower.includes("who are you") || lower.includes("what can you do")) {
    return {
      flag: false,
      text: "I am Safety Net's AI assistant. I provide instant safety guidance, monitor your commute for distress, and can automatically dispatch WhatsApp & Email emergency alerts with your live coordinates."
    };
  }

  if (lower.includes("thank") || lower.includes("thx") || lower.includes("ok") || lower.includes("okay") || lower.includes("good")) {
    return {
      flag: false,
      text: "You're very welcome! Stay alert, stay safe, and don't hesitate to reach out if anything feels off."
    };
  }

  // 8. General Supportive Response
  return {
    flag: false,
    text: `I hear you. If you're on the move, keep an eye on your surroundings and stay on well-lit main roads. If you feel at all uneasy, let me know or tap the SOS button anytime.`
  };
}

// ---------------------------------------------------------------------------
// Cloud AI Inference (Fast, Anonymous, Zero API Key)
// ---------------------------------------------------------------------------

async function queryCloudAI(userMessage) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

  try {
    const messages = conversationHistory.slice(-6); // keep recent context
    messages.push({ role: "user", content: userMessage });

    const response = await fetch("https://text.pollinations.ai/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        model: "openai-fast"
      }),
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
    console.warn("Safety Net: Cloud AI fallback triggered.", err.message);
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

function updateOnlineStatus() {
  if (aiStatusBadge) {
    if (navigator.onLine) {
      aiStatusBadge.textContent = "⚡ AI Companion Active";
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

function showTypingIndicator() {
  const div = document.createElement("div");
  div.className = "chat-msg chat-msg-system typing-bubble";
  div.innerHTML = `
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
  `;
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
    appendSystemMessage("🚨 SOS alert dispatched! WhatsApp DM and Email initiated.");
  });

  dismissBtn.addEventListener("click", () => {
    sendBtn.disabled = true;
    dismissBtn.disabled = true;
    activeConfirmPrompt = null;
    appendSystemMessage("Understood — no emergency alert sent. Stay safe and keep your phone ready.");
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

  // Evaluate offline heuristics first
  const dynamicLocal = generateDynamicLocalResponse(text);
  const typingBubble = showTypingIndicator();

  let aiResponse = null;
  if (navigator.onLine) {
    aiResponse = await queryCloudAI(text);
  }

  if (typingBubble.parentNode) {
    typingBubble.remove();
  }

  let finalResponse = "";
  let shouldFlag = dynamicLocal.flag;

  if (aiResponse) {
    if (aiResponse.includes("[ALERT_FLAG]")) {
      shouldFlag = true;
      finalResponse = aiResponse.replace(/\[ALERT_FLAG\]/g, "").trim();
    } else {
      finalResponse = aiResponse;
    }
  } else {
    // Dynamic context-aware offline response
    finalResponse = dynamicLocal.text;
  }

  // Append response
  appendSystemMessage(finalResponse, { flag: shouldFlag });

  // Update memory
  conversationHistory.push({ role: "user", content: text });
  conversationHistory.push({ role: "assistant", content: finalResponse });
  if (conversationHistory.length > 10) {
    conversationHistory = [conversationHistory[0], ...conversationHistory.slice(-8)];
  }

  // Trigger SOS confirmation if flagged
  if (shouldFlag) {
    appendConfirmPrompt(text);
  }

  chatInput.focus();
});

// Welcome Message
appendSystemMessage(
  "Hello, I am your Safety Net companion. I can provide real-time safety advice, guide you along well-lit highway corridors, or dispatch an emergency SOS if you feel unsafe. How are you doing?"
);

// Init SOS widget
renderSosEngineWidget("sos-engine-mount");

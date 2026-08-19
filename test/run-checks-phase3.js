const fs = require("fs");
const { chromium } = require("playwright");

function findChromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  try {
    const dir = `${process.env.HOME}/.cache/puppeteer/chrome`;
    const matches = fs.existsSync(dir)
      ? fs.readdirSync(dir).map((d) => `${dir}/${d}/chrome-linux64/chrome`).filter((p) => fs.existsSync(p))
      : [];
    if (matches.length) return matches[0];
  } catch (_) {
    /* fall through */
  }
  return undefined;
}

const BASE = process.env.SAFETY_NET_URL || "http://localhost:8765";

(async () => {
  const errors = [];
  const pageErrors = [];
  const chromePath = findChromePath();
  const browser = await chromium.launch({
    ...(chromePath ? { executablePath: chromePath } : {}),
    args: ["--no-sandbox"],
  });

  const context = await browser.newContext({
    permissions: ["geolocation"],
    geolocation: { latitude: 37.7749, longitude: -122.4194 },
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  // ---- Check-in card (checkin.html): blocked without a valid trusted
  // contact ------------------------------------------------------------
  await page.goto(`${BASE}/checkin.html`);
  const gateTextBefore = await page.locator("#checkin-contact-gate").textContent();
  console.log("Contact gate note shown before any contact saved:", gateTextBefore);
  await page.fill("#checkin-minutes", "1");
  await page.click("#checkin-start-btn");
  const blockedStatus = await page.locator("#checkin-status").textContent();
  console.log("Check-in blocked without trusted contact:", blockedStatus);
  const stillHiddenNoContact = await page.locator("#checkin-active-area").isHidden();
  console.log("Check-in stayed inactive without a contact:", stillHiddenNoContact);

  // Add a valid trusted contact via the landing page (the real entry point
  // in the new structure), then come back to checkin.html and confirm it
  // picked up the same saved record.
  await page.goto(`${BASE}/index.html`);
  await page.fill("#contact-name", "Riley");
  await page.fill("#contact-email", "riley@example.com");
  await page.click("#contact-form button[type=submit]");
  await page.goto(`${BASE}/checkin.html`);
  const gateTextAfter = await page.locator("#checkin-contact-gate").textContent();
  console.log("Contact gate note reflects contact saved on a different page:", gateTextAfter);

  // ---- Check-in card: minutes input clamps to [1, 180] -------------------
  await page.fill("#checkin-minutes", "500");
  await page.click("#checkin-start-btn");
  const clampedValue = await page.locator("#checkin-minutes").inputValue();
  console.log("Minutes input clamped to max (should be 180):", clampedValue);
  const activeAfterClamp = await page.locator("#checkin-active-area").isVisible();
  console.log("Check-in active after clamped start:", activeAfterClamp);

  // ---- NEW this session: can't start a second timer while one is active -
  // The Start form is hidden while active (setActiveUi(true)) — confirm
  // there is no way to submit a second start while one's running, and that
  // beginCheckin() itself no-ops if a state already exists (belt & braces:
  // both the UI and the underlying guard are checked).
  const formHiddenWhileActive = await page.locator("#checkin-form").isHidden();
  console.log("Start form is hidden while a check-in is already active (no way to double-start via UI):", formHiddenWhileActive);
  const deadlineBeforeRetry = await page.evaluate(() => JSON.parse(localStorage.getItem("safetyNet.checkin")).deadline);
  await page.evaluate(() => beginCheckin(999 * 60 * 1000)); // attempt a second start programmatically
  const deadlineAfterRetry = await page.evaluate(() => JSON.parse(localStorage.getItem("safetyNet.checkin")).deadline);
  console.log("A second beginCheckin() call while one is active is a no-op (deadline unchanged):", deadlineBeforeRetry === deadlineAfterRetry);

  await page.click("#checkin-cancel-btn");
  const canceledStatus = await page.locator("#checkin-status").textContent();
  console.log("Status after manual cancel:", canceledStatus);
  const hiddenAfterCancel = await page.locator("#checkin-active-area").isHidden();
  console.log("Check-in hidden after cancel:", hiddenAfterCancel);

  // ---- Check-in card: "I'm safe" resets the deadline ---------------------
  await page.evaluate(() => beginCheckin(5 * 60 * 1000));
  await page.click("#checkin-safe-btn");
  const safeStatus = await page.locator("#checkin-status").textContent();
  console.log("Status after 'I'm safe':", safeStatus);
  const stillActiveAfterSafe = await page.locator("#checkin-active-area").isVisible();
  console.log("Still active after checking in safe:", stillActiveAfterSafe);
  await page.click("#checkin-cancel-btn");

  // ---- Check-in card: elapsed timer auto-fires the SOS pipeline ----------
  await page.evaluate(() => beginCheckin(1200));
  await page.waitForFunction(
    () => document.getElementById("checkin-status").textContent.includes("SOS alert triggered"),
    { timeout: 8000 }
  );
  const elapsedStatus = await page.locator("#checkin-status").textContent();
  console.log("Status after check-in elapses unattended:", elapsedStatus);
  const engineStatusAfterCheckin = await page.locator("#sos-engine-status").textContent();
  console.log("SOS engine status after check-in auto-fire:", engineStatusAfterCheckin);
  const previewAfterCheckin = await page.locator("#message-preview").textContent();
  const previewMentionsCheckin = previewAfterCheckin.includes('did not tap "I\'m safe"');
  console.log("Alert message names the check-in trigger:", previewMentionsCheckin);
  const hiddenAfterElapse = await page.locator("#checkin-active-area").isHidden();
  console.log("Check-in card returns to inactive after firing:", hiddenAfterElapse);

  // ---- Check-in card: state resumes across a reload -----------------------
  await page.evaluate(() => beginCheckin(60 * 1000));
  await page.reload();
  const activeAfterReload = await page.locator("#checkin-active-area").isVisible();
  console.log("Check-in still active after a reload (resumed from storage):", activeAfterReload);
  await page.click("#checkin-cancel-btn");

  // ---- Check-in card: a deadline that already passed while the tab was
  // closed fires immediately on next load.
  await page.evaluate(() => {
    localStorage.setItem("safetyNet.checkin", JSON.stringify({ deadline: Date.now() - 5000, durationMs: 60000 }));
  });
  await page.reload();
  await page.waitForFunction(
    () => document.getElementById("checkin-status").textContent.includes("SOS alert triggered"),
    { timeout: 8000 }
  );
  const lateFireStatus = await page.locator("#checkin-status").textContent();
  console.log("Status when reopened after the deadline already passed:", lateFireStatus);
  const checkinKeyClearedAfterLateFire = await page.evaluate(() => localStorage.getItem("safetyNet.checkin") === null);
  console.log("localStorage check-in key cleared after late auto-fire:", checkinKeyClearedAfterLateFire);

  // ---- Chat card (chat.html): ordinary message does not flag -------------
  await page.goto(`${BASE}/chat.html`);
  await page.fill("#chat-input", "hey, just checking in, all good");
  await page.click("#chat-send-btn");
  const userBubbleCount = await page.locator(".chat-msg-user").count();
  const flagCountAfterNormal = await page.locator(".chat-msg-flag").count();
  console.log("User bubble rendered for normal message:", userBubbleCount >= 1);
  console.log("No flag prompt for a normal message:", flagCountAfterNormal === 0);

  // ---- Chat card: distress phrase triggers a confirm prompt, dismiss path
  await page.fill("#chat-input", "someone is following me and I don't feel safe");
  await page.click("#chat-send-btn");
  await page.waitForSelector(".chat-msg-flag", { timeout: 2000 });
  const flagVisible = await page.locator(".chat-msg-flag").last().isVisible();
  console.log("Distress phrase shows a flagged confirm prompt:", flagVisible);

  // ---- NEW this session: repeated distress phrases don't stack duplicate
  // confirm prompts — send a second (different) distress phrase WHILE the
  // first prompt is still unresolved.
  const flagCountBeforeSecond = await page.locator(".chat-msg-flag").count();
  await page.fill("#chat-input", "im scared, please help me");
  await page.click("#chat-send-btn");
  await page.waitForTimeout(200);
  const flagCountAfterSecond = await page.locator(".chat-msg-flag").count();
  const confirmRowCount = await page.locator(".chat-confirm-row").count();
  console.log(
    "A second distress message while one prompt is still open does NOT add a second confirm-row (dedup works):",
    flagCountAfterSecond === flagCountBeforeSecond && confirmRowCount === 1
  );
  const waitingNoticeVisible = await page.locator("#chat-log").textContent();
  console.log(
    "A 'please confirm the one above first' notice was shown instead:",
    waitingNoticeVisible.includes("Still waiting on your answer")
  );

  // Resolve the outstanding prompt via dismiss.
  await page.locator(".chat-confirm-row button", { hasText: "No, I'm okay" }).last().click();
  const dismissedText = await page.locator("#chat-log").textContent();
  console.log("Dismiss path recorded 'no alert sent':", dismissedText.includes("OK — no alert sent."));

  // Now that the prompt is resolved, a NEW distress message should get its
  // own fresh prompt (dedup only blocks while one is outstanding). Prior
  // resolved prompts stay in the log (their buttons disabled, same as any
  // chat history) rather than being removed, so we compare counts
  // before/after instead of asserting an absolute count of 1.
  const confirmRowCountBeforeFresh = await page.locator(".chat-confirm-row").count();
  await page.fill("#chat-input", "im trapped, cant get away");
  await page.click("#chat-send-btn");
  await page.waitForFunction(
    (prevCount) => document.querySelectorAll(".chat-confirm-row").length > prevCount,
    confirmRowCountBeforeFresh,
    { timeout: 2000 }
  );
  const freshPromptAfterResolve = await page.locator(".chat-confirm-row").count();
  console.log(
    "A fresh distress message after the prior prompt resolved gets its own new prompt:",
    freshPromptAfterResolve === confirmRowCountBeforeFresh + 1
  );

  // ---- Chat card: distress phrase, confirm path actually fires SOS -------
  await page.locator(".chat-confirm-row button", { hasText: "Send SOS now" }).last().click();
  await page.waitForFunction(() => document.getElementById("chat-log").textContent.includes("SOS triggered"), {
    timeout: 8000,
  });
  const previewAfterChat = await page.locator("#message-preview").textContent();
  const previewMentionsChat = previewAfterChat.includes("chat check-in flagged possible distress");
  console.log("Alert message names the chat-detector trigger:", previewMentionsChat);

  // ---- Chat card: XSS payload renders inert -------------------------------
  await page.fill("#chat-input", '<img src=x onerror="window.__chatxss=true">');
  await page.click("#chat-send-btn");
  await page.waitForTimeout(150);
  const chatXssFired = await page.evaluate(() => window.__chatxss === true);
  console.log("Chat XSS payload executed (should be false):", chatXssFired);
  const lastBubbleText = await page.locator(".chat-msg-user").last().textContent();
  console.log(
    "XSS payload rendered as inert text:",
    lastBubbleText.includes('<img src=x onerror="window.__chatxss=true">')
  );

  await context.close();
  await browser.close();

  console.log("\n=== console.error / pageerror summary (check-in + chat) ===");
  console.log("console.error count:", errors.length, errors);
  console.log("pageerror count:", pageErrors.length, pageErrors);

  if (errors.length || pageErrors.length) {
    process.exitCode = 1;
  }
})();

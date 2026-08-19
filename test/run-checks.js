const fs = require("fs");
const { chromium } = require("playwright");

// Resolve a Chrome/Chromium binary without assuming a specific machine layout:
// 1) explicit override, 2) Playwright's own managed browser, 3) a Puppeteer
// cache dir if one happens to exist, 4) let Playwright try its own default
// and surface a clear error if nothing is found.
function findChromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const puppeteerCacheGlob =
    `${process.env.HOME}/.cache/puppeteer/chrome/*/chrome-linux64/chrome`;
  try {
    const matches = fs.existsSync(`${process.env.HOME}/.cache/puppeteer/chrome`)
      ? fs
          .readdirSync(`${process.env.HOME}/.cache/puppeteer/chrome`)
          .map((d) => `${process.env.HOME}/.cache/puppeteer/chrome/${d}/chrome-linux64/chrome`)
          .filter((p) => fs.existsSync(p))
      : [];
    if (matches.length) return matches[0];
  } catch (_) {
    /* fall through */
  }
  return undefined; // let Playwright use its own resolution/managed browser
}

(async () => {
  const errors = [];
  const pageErrors = [];
  const chromePath = findChromePath();
  const browser = await chromium.launch({
    ...(chromePath ? { executablePath: chromePath } : {}),
    args: ["--no-sandbox"],
  });

  // ---- Test 1: normal flow, geolocation GRANTED --------------------------
  {
    const context = await browser.newContext({
      permissions: ["geolocation"],
      geolocation: { latitude: 12.9716, longitude: 77.5946 },
    });
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[granted-flow] ${msg.text()}`);
    });
    page.on("pageerror", (err) => pageErrors.push(`[granted-flow] ${err.message}`));

    await page.goto("http://localhost:8765/index.html");

    // Try to arm before contact exists -> should be disabled/blocked
    const disabledBeforeContact = await page.locator("#sos-btn").isDisabled();
    console.log("SOS button disabled before contact saved:", disabledBeforeContact);

    // Invalid email should be rejected with a visible error, contact not saved
    await page.fill("#contact-name", "Test");
    await page.fill("#contact-email", "not-an-email");
    await page.click("#contact-form button[type=submit]");
    const emailErrVisible = await page.locator("#email-error").isVisible();
    console.log("Invalid email shows field error:", emailErrVisible);
    const stillDisabled = await page.locator("#sos-btn").isDisabled();
    console.log("SOS still disabled after invalid submit:", stillDisabled);
    await page.fill("#contact-email", "");

    // Fill in an XSS-attempt name + valid email/phone
    await page.fill("#contact-name", '<img src=x onerror="window.__xss=true">Alex');
    await page.fill("#contact-email", "trusted@example.com");
    await page.fill("#contact-phone", "+1 555 123 4567");
    await page.click("#contact-form button[type=submit]");

    const xssFired = await page.evaluate(() => window.__xss === true);
    console.log("XSS payload executed (should be false):", xssFired);

    const statusText = await page.locator("#contact-status").textContent();
    console.log("Contact status text (should show raw tag as text, unescaped-looking but inert):", statusText);

    const disabledAfterContact = await page.locator("#sos-btn").isDisabled();
    console.log("SOS button disabled after valid contact saved:", disabledAfterContact);

    // Quick single tap (release well under HOLD_MS, outside double-tap window)
    // should NOT arm on its own.
    const box0 = await page.locator("#sos-btn").boundingBox();
    await page.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.up();
    await page.waitForTimeout(600); // let any accidental double-tap window expire
    const notArmedFromSingleTap = await page.locator("#countdown-area").isHidden();
    console.log("Single quick tap does NOT arm:", notArmedFromSingleTap);

    // Double-tap to arm
    await page.click("#sos-btn");
    await page.click("#sos-btn");
    await page.waitForSelector("#countdown-area:not([hidden])", { timeout: 2000 });
    const countdownVisible = await page.locator("#countdown-area").isVisible();
    console.log("Countdown visible after double-tap arm:", countdownVisible);

    // Cancel it
    await page.click("#cancel-btn");
    await page.waitForTimeout(200);
    const countdownHiddenAfterCancel = await page.locator("#countdown-area").isHidden();
    console.log("Countdown hidden after cancel:", countdownHiddenAfterCancel);
    const statusAfterCancel = await page.locator("#sos-status").textContent();
    console.log("Status after cancel:", statusAfterCancel);

    // Press-and-hold to arm, then let it fire (geolocation granted)
    const box = await page.locator("#sos-btn").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(900); // > HOLD_MS
    await page.mouse.up();

    const armedLabel = await page.locator("#sos-btn-label").textContent();
    console.log("Label right after hold-arm:", armedLabel);

    // Wait out the 5s countdown + fire
    await page.waitForFunction(
      () => document.getElementById("sos-status").textContent.includes("Opening your email app"),
      { timeout: 10000 }
    );
    const finalStatus = await page.locator("#sos-status").textContent();
    console.log("Final status after granted-geolocation fire:", finalStatus);

    const messagePreview = await page.locator("#message-preview").textContent();
    console.log("---- message preview (granted-geo) ----");
    console.log(messagePreview);
    console.log("----------------------------------------");

    const containsMapsLink = messagePreview.includes("https://www.google.com/maps?q=12.9716");
    console.log("Message contains maps link with expected coords:", containsMapsLink);

    // Copy button
    await page.click("#copy-btn");
    await page.waitForTimeout(100);
    const copyStatus = await page.locator("#copy-status").textContent();
    console.log("Copy status:", copyStatus);

    await context.close();
  }

  // ---- Test 2: geolocation DENIED -> manual fallback ----------------------
  {
    const context = await browser.newContext({ permissions: [] });
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[denied-flow] ${msg.text()}`);
    });
    page.on("pageerror", (err) => pageErrors.push(`[denied-flow] ${err.message}`));

    // Deny geolocation explicitly at the CDP level so getCurrentPosition errors out
    await context.grantPermissions([]);
    const client = await context.newCDPSession(page);
    await client.send("Browser.grantPermissions", { permissions: [] }).catch(() => {});

    await page.goto("http://localhost:8765/index.html");
    // Force geolocation to always error, simulating a user denial, regardless
    // of platform geolocation availability in this sandbox.
    await page.addInitScript(() => {
      const deny = (success, error) =>
        error && error({ code: 1, message: "User denied Geolocation" });
      Object.defineProperty(window.navigator, "geolocation", {
        value: { getCurrentPosition: deny, watchPosition: deny },
      });
    });
    await page.reload();

    await page.fill("#contact-name", "Sam");
    await page.fill("#contact-email", "sam@example.com");
    await page.click("#contact-form button[type=submit]");

    await page.click("#sos-btn");
    await page.click("#sos-btn"); // double-tap arm
    await page.waitForSelector("#countdown-area:not([hidden])", { timeout: 2000 });

    // let the 5s countdown run out
    await page.waitForSelector("#manual-location-card:not([hidden])", { timeout: 10000 });
    const manualVisible = await page.locator("#manual-location-card").isVisible();
    console.log("Manual location fallback shown on geolocation denial:", manualVisible);

    await page.fill("#manual-location-input", "Outside Central Library, north entrance");
    await page.click("#manual-location-form button[type=submit]");

    await page.waitForFunction(
      () => document.getElementById("sos-status").textContent.includes("Opening your email app"),
      { timeout: 5000 }
    );
    const finalStatus2 = await page.locator("#sos-status").textContent();
    console.log("Final status after denied-geolocation manual fallback:", finalStatus2);

    const msg2 = await page.locator("#message-preview").textContent();
    const containsManualText = msg2.includes("Outside Central Library, north entrance");
    console.log("Message includes manually entered location:", containsManualText);

    await context.close();
  }

  await browser.close();

  console.log("\n=== console.error / pageerror summary ===");
  console.log("console.error count:", errors.length, errors);
  console.log("pageerror count:", pageErrors.length, pageErrors);

  if (errors.length || pageErrors.length) {
    process.exitCode = 1;
  }
})();

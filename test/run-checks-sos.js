const fs = require("fs");
const { chromium } = require("playwright");

// Resolve a Chrome/Chromium binary without assuming a specific machine layout.
function findChromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const puppeteerCacheGlob = `${process.env.HOME}/.cache/puppeteer/chrome`;
  try {
    const matches = fs.existsSync(puppeteerCacheGlob)
      ? fs
          .readdirSync(puppeteerCacheGlob)
          .map((d) => `${puppeteerCacheGlob}/${d}/chrome-linux64/chrome`)
          .filter((p) => fs.existsSync(p))
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

  // ---- Test 1: normal flow, geolocation GRANTED, on sos.html -------------
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

    // Set up the trusted contact on the landing page first (this is the
    // new entry flow: contact setup lives on index.html, not sos.html).
    await page.goto(`${BASE}/index.html`);

    const disabledBeforeContact = await page.locator("#sos-btn").count(); // sos.html not loaded yet; sanity check landing page has the setup form
    console.log("Landing page shows contact setup form when none saved:", (await page.locator("#contact-form").count()) === 1);

    await page.fill("#contact-name", "Test");
    await page.fill("#contact-email", "not-an-email");
    await page.click("#contact-form button[type=submit]");
    const emailErrVisible = await page.locator("#email-error").isVisible();
    console.log("Invalid email shows field error on landing page:", emailErrVisible);
    await page.fill("#contact-email", "");

    // XSS-attempt name + valid email/phone.
    await page.fill("#contact-name", '<img src=x onerror="window.__xss=true">Alex');
    await page.fill("#contact-email", "trusted@example.com");
    await page.fill("#contact-phone", "+1 555 123 4567");
    await page.click("#contact-form button[type=submit]");

    const xssFired = await page.evaluate(() => window.__xss === true);
    console.log("XSS payload executed on landing page (should be false):", xssFired);

    const welcomeVisible = await page.locator(".contact-status").isVisible();
    console.log("Landing page shows welcome-back state after saving:", welcomeVisible);
    const welcomeText = await page.locator(".contact-status").textContent();
    console.log("Welcome-back status text (raw tag rendered as inert text):", welcomeText);

    // Now go to sos.html and confirm it picked up the same saved contact.
    await page.goto(`${BASE}/sos.html`);
    const disabledAfterContact = await page.locator("#sos-btn").isDisabled();
    console.log("SOS button enabled on sos.html after contact saved elsewhere:", !disabledAfterContact);

    // Quick single tap should NOT arm.
    const box0 = await page.locator("#sos-btn").boundingBox();
    await page.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.up();
    await page.waitForTimeout(600);
    const notArmedFromSingleTap = await page.locator("#countdown-area").isHidden();
    console.log("Single quick tap does NOT arm:", notArmedFromSingleTap);

    // Double-tap to arm, then cancel.
    await page.click("#sos-btn");
    await page.click("#sos-btn");
    await page.waitForSelector("#countdown-area:not([hidden])", { timeout: 2000 });
    const countdownVisible = await page.locator("#countdown-area").isVisible();
    console.log("Countdown visible after double-tap arm:", countdownVisible);

    await page.click("#cancel-btn");
    await page.waitForTimeout(200);
    const countdownHiddenAfterCancel = await page.locator("#countdown-area").isHidden();
    console.log("Countdown hidden after cancel:", countdownHiddenAfterCancel);
    const btnEnabledAfterCancel = !(await page.locator("#sos-btn").isDisabled());
    console.log("SOS button re-enabled immediately after cancel (no cooldown on cancel-only):", btnEnabledAfterCancel);

    // Press-and-hold to arm, then let it fire (geolocation granted).
    const box = await page.locator("#sos-btn").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(900);
    await page.mouse.up();

    const armedLabel = await page.locator("#sos-btn-label").textContent();
    console.log("Label right after hold-arm:", armedLabel);

    await page.waitForFunction(
      () => document.getElementById("sos-status").textContent.includes("Opening your email app"),
      { timeout: 10000 }
    );
    const finalStatus = await page.locator("#sos-status").textContent();
    console.log("Final status after granted-geolocation fire:", finalStatus);

    const messagePreview = await page.locator("#message-preview").textContent();
    const containsMapsLink = messagePreview.includes("https://www.google.com/maps?q=12.9716");
    console.log("Message contains maps link with expected coords:", containsMapsLink);

    await page.click("#copy-btn");
    await page.waitForTimeout(100);
    const copyStatus = await page.locator("#copy-status").textContent();
    console.log("Copy status:", copyStatus);

    // ---- NEW this session: cooldown blocks an immediate second fire -----
    const disabledDuringCooldown = await page.locator("#sos-btn").isDisabled();
    console.log("SOS button disabled immediately after a fire (cooldown active):", disabledDuringCooldown);
    const cooldownNoticeVisible = await page.locator("#cooldown-notice").isVisible();
    console.log("Cooldown notice visible after fire:", cooldownNoticeVisible);
    const cooldownNoticeText = await page.locator("#cooldown-notice").textContent();
    console.log("Cooldown notice text:", cooldownNoticeText);

    // Try to arm again right away — should be impossible (button disabled),
    // proving the cooldown actually blocks a second attempt, not just shows
    // a notice cosmetically.
    await page.click("#sos-btn", { force: true }).catch(() => {});
    await page.click("#sos-btn", { force: true }).catch(() => {});
    await page.waitForTimeout(200);
    const stillNotArmedDuringCooldown = await page.locator("#countdown-area").isHidden();
    console.log("A second SOS attempt during cooldown does NOT arm:", stillNotArmedDuringCooldown);

    await context.close();
  }

  // ---- Test 2: geolocation DENIED -> manual fallback, on sos.html --------
  {
    const context = await browser.newContext({ permissions: [] });
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[denied-flow] ${msg.text()}`);
    });
    page.on("pageerror", (err) => pageErrors.push(`[denied-flow] ${err.message}`));

    await context.grantPermissions([]);
    const client = await context.newCDPSession(page);
    await client.send("Browser.grantPermissions", { permissions: [] }).catch(() => {});

    await page.goto(`${BASE}/index.html`);
    await page.addInitScript(() => {
      const deny = (success, error) => error && error({ code: 1, message: "User denied Geolocation" });
      Object.defineProperty(window.navigator, "geolocation", {
        value: { getCurrentPosition: deny, watchPosition: deny },
      });
    });
    await page.reload();

    await page.fill("#contact-name", "Sam");
    await page.fill("#contact-email", "sam@example.com");
    await page.click("#contact-form button[type=submit]");

    await page.goto(`${BASE}/sos.html`);
    await page.click("#sos-btn");
    await page.click("#sos-btn");
    await page.waitForSelector("#countdown-area:not([hidden])", { timeout: 2000 });

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

  // ---- Test 3: nav bar works from every page, both directions -----------
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[nav] ${msg.text()}`);
    });
    page.on("pageerror", (err) => pageErrors.push(`[nav] ${err.message}`));

    const pages = [
      { path: "index.html", key: "index" },
      { path: "sos.html", key: "sos" },
      { path: "route.html", key: "route" },
      { path: "history.html", key: "history" },
      { path: "checkin.html", key: "checkin" },
      { path: "chat.html", key: "chat" },
    ];

    let allNavLinksOk = true;
    for (const p of pages) {
      await page.goto(`${BASE}/${p.path}`);
      const navExists = await page.locator(".site-nav").count();
      if (navExists !== 1) {
        allNavLinksOk = false;
        console.log(`Nav missing on ${p.path}`);
        continue;
      }
      const linkCount = await page.locator(".site-nav-list a").count();
      if (linkCount !== 6) {
        allNavLinksOk = false;
        console.log(`Nav on ${p.path} has ${linkCount} links, expected 6`);
      }
      const activeText = await page.locator("a.site-nav-active").count();
      if (activeText !== 1) {
        allNavLinksOk = false;
        console.log(`Nav on ${p.path} doesn't mark exactly one active link`);
      }
    }
    console.log("Nav bar present with 6 links + correct active state on every page:", allNavLinksOk);

    // Click through every link from index.html and confirm we land on a
    // real 200 page each time (no 404s / broken links).
    await page.goto(`${BASE}/index.html`);
    let clickThroughOk = true;
    for (const p of pages) {
      if (p.key === "index") continue;
      await page.goto(`${BASE}/index.html`);
      const resp = await Promise.all([
        page.waitForNavigation(),
        page.click(`.site-nav-list a[href="${p.path}"]`),
      ]).then(([resp]) => resp);
      if (!resp || !resp.ok()) {
        clickThroughOk = false;
        console.log(`Nav click to ${p.path} did not return OK:`, resp && resp.status());
      }
      // And back to index.
      const resp2 = await Promise.all([
        page.waitForNavigation(),
        page.click(`.site-nav-list a[href="index.html"]`),
      ]).then(([resp]) => resp);
      if (!resp2 || !resp2.ok()) {
        clickThroughOk = false;
        console.log(`Nav click back to index.html from ${p.path} did not return OK:`, resp2 && resp2.status());
      }
    }
    console.log("Clicking every nav link forward and back returns 200 (no broken links):", clickThroughOk);

    await context.close();
  }

  await browser.close();

  console.log("\n=== console.error / pageerror summary (SOS + nav) ===");
  console.log("console.error count:", errors.length, errors);
  console.log("pageerror count:", pageErrors.length, pageErrors);

  if (errors.length || pageErrors.length) {
    process.exitCode = 1;
  }
})();

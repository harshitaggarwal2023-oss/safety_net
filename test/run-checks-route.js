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

  // ---- Test 1: Safe Route Planner (route.html) — real geocoding + routing
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[route-planner] ${msg.text()}`);
    });
    page.on("pageerror", (err) => pageErrors.push(`[route-planner] ${err.message}`));

    await page.goto(`${BASE}/route.html`, { waitUntil: "networkidle" });

    const mapRendered = await page.evaluate(() => !!document.querySelector(".leaflet-container"));
    console.log("Leaflet map rendered on route.html:", mapRendered);

    await page.fill("#route-start", "Ferry Building, San Francisco");
    await page.fill("#route-dest", "Golden Gate Park, San Francisco");

    // Double-click / rapid resubmit guard test: click the submit button
    // twice in immediate succession. If the routeRequestInFlight guard
    // works, only one set of results/one "Finding routes…" -> final status
    // transition should happen; console errors would spike if two
    // overlapping fetches both tried to mutate the DOM/map concurrently
    // (e.g. duplicate polylines from a race), so we check final state
    // makes sense and no console errors piled up from a race.
    await Promise.all([page.click("#find-routes-btn"), page.click("#find-routes-btn")]);

    await page.waitForFunction(
      () => {
        const s = document.getElementById("route-status").textContent;
        return s.includes("route options found") || s.includes("Only one") || s.includes("Couldn't");
      },
      { timeout: 20000 }
    );

    const routeStatus = await page.locator("#route-status").textContent();
    console.log("Route status (real geocode + real OSRM route):", routeStatus);

    const scoreBadges = await page.locator(".score-badge").allTextContents();
    console.log("Score badges shown:", scoreBadges);
    const gotScores = scoreBadges.length > 0;
    console.log("At least one safety score rendered:", gotScores);

    // Double-click guard: the route-options list should show one clean set
    // of route entries (1-3), not duplicated entries from two overlapping
    // requests both rendering.
    const optionCount = await page.locator(".route-option").count();
    console.log("Route options count is sane (1-3, not duplicated by the double-click):", optionCount >= 1 && optionCount <= 3);

    const polylineCount = await page.evaluate(() => document.querySelectorAll("path.leaflet-interactive").length);
    console.log("Route polylines drawn on map:", polylineCount);

    // XSS attempt via the free-text start field.
    await page.fill("#route-start", '<img src=x onerror="window.__xssRoute=true">');
    await page.fill("#route-dest", "Golden Gate Park, San Francisco");
    await page.click("#find-routes-btn");
    await page.waitForFunction(
      () => document.getElementById("route-status").textContent.includes("Couldn't find"),
      { timeout: 15000 }
    );
    const xssFired = await page.evaluate(() => window.__xssRoute === true);
    console.log("XSS payload in route input executed (should be false):", xssFired);

    await context.close();
  }

  // ---- Test 2: route scoring differentiates near a high-weight mock zone -
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[scoring] ${msg.text()}`);
    });
    page.on("pageerror", (err) => pageErrors.push(`[scoring] ${err.message}`));

    await page.goto(`${BASE}/route.html`, { waitUntil: "networkidle" });

    await page.fill("#route-start", "37.7290, -122.4540");
    await page.fill("#route-dest", "37.7270, -122.4520");
    await page.click("#find-routes-btn");
    await page.waitForFunction(
      () => {
        const s = document.getElementById("route-status").textContent;
        return s.includes("route options found") || s.includes("Only one") || s.includes("Couldn't");
      },
      { timeout: 20000 }
    );
    const nearZoneScore = await page.locator(".score-badge").first().textContent();
    console.log("Score for a route centered on a high-weight mock zone:", nearZoneScore);
    const scoreNum = parseInt((nearZoneScore.match(/\((\d+)\/100\)/) || [])[1] || "100", 10);
    console.log("Score is meaningfully lower than the 90s baseline (expect < 80):", scoreNum < 80);

    await context.close();
  }

  // ---- Test 3: opt-in route history tracking, now on its own page --------
  {
    const context = await browser.newContext({
      permissions: ["geolocation"],
      geolocation: { latitude: 37.7749, longitude: -122.4194 },
    });
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[tracking] ${msg.text()}`);
    });
    page.on("pageerror", (err) => pageErrors.push(`[tracking] ${err.message}`));

    await page.goto(`${BASE}/history.html`, { waitUntil: "networkidle" });

    const mapRendered = await page.evaluate(() => !!document.querySelector(".leaflet-container"));
    console.log("Leaflet map rendered on history.html (own instance):", mapRendered);

    const startVisibleBefore = await page.locator("#start-tracking-btn").isVisible();
    const stopVisibleBefore = await page.locator("#stop-tracking-btn").isVisible();
    const indicatorVisibleBefore = await page.locator("#tracking-indicator").isVisible();
    console.log(
      "Tracking defaults OFF (start visible, stop hidden, indicator hidden):",
      startVisibleBefore && !stopVisibleBefore && !indicatorVisibleBefore
    );

    const historyBeforeStart = await page.evaluate(() => localStorage.getItem("safetyNet.routeHistory"));
    console.log("No route history stored before opt-in:", historyBeforeStart === null);

    await page.click("#start-tracking-btn");
    await page.waitForTimeout(800);

    const indicatorVisibleAfter = await page.locator("#tracking-indicator").isVisible();
    const indicatorText = await page.locator("#tracking-indicator").textContent();
    console.log("Tracking indicator visible after Start:", indicatorVisibleAfter, "| text:", indicatorText);

    await context.setGeolocation({ latitude: 37.776, longitude: -122.421 });
    await page.waitForTimeout(700);
    await context.setGeolocation({ latitude: 37.777, longitude: -122.422 });
    await page.waitForTimeout(700);

    const polylinesDuring = await page.evaluate(() => document.querySelectorAll("path.leaflet-interactive").length);
    console.log("A tracking polyline is drawn on the map (>=1):", polylinesDuring >= 1);

    await page.click("#stop-tracking-btn");
    await page.waitForTimeout(300);

    const indicatorVisibleAfterStop = await page.locator("#tracking-indicator").isVisible();
    const startVisibleAfterStop = await page.locator("#start-tracking-btn").isVisible();
    console.log(
      "After Stop: indicator hidden, Start button visible again:",
      !indicatorVisibleAfterStop && startVisibleAfterStop
    );

    const sessionsAfterStop = await page.evaluate(() => {
      const raw = localStorage.getItem("safetyNet.routeHistory");
      return raw ? JSON.parse(raw) : null;
    });
    console.log(
      "Session saved to localStorage with >=2 points, on-device only:",
      !!sessionsAfterStop && sessionsAfterStop.length === 1 && sessionsAfterStop[0].points.length >= 2
    );

    await page.click("#clear-history-btn");
    await page.waitForTimeout(200);
    const historyAfterClear = await page.evaluate(() => localStorage.getItem("safetyNet.routeHistory"));
    console.log("Clear route history actually deletes stored data:", historyAfterClear === null);

    await context.close();
  }

  // ---- Test 4: SOS (fired from sos.html) auto-stops tracking on
  // history.html — the cross-tab signal test. This is the key regression
  // check for the multi-page split: in the old single-page app this was a
  // same-document CustomEvent; now it MUST cross a tab boundary via
  // localStorage's `storage` event (see sos-engine.js's broadcastSosEnded).
  {
    const context = await browser.newContext({
      permissions: ["geolocation"],
      geolocation: { latitude: 37.7749, longitude: -122.4194 },
    });

    // Set up a valid contact first (shared localStorage across pages/tabs
    // in the same context).
    const setupPage = await context.newPage();
    await setupPage.goto(`${BASE}/index.html`);
    await setupPage.fill("#contact-name", "Test Contact");
    await setupPage.fill("#contact-email", "test@example.com");
    await setupPage.click("#contact-form button[type=submit]");
    await setupPage.close();

    const historyPage = await context.newPage();
    historyPage.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[sos-autostop:history] ${msg.text()}`);
    });
    historyPage.on("pageerror", (err) => pageErrors.push(`[sos-autostop:history] ${err.message}`));
    await historyPage.goto(`${BASE}/history.html`, { waitUntil: "networkidle" });
    await historyPage.click("#start-tracking-btn");
    await historyPage.waitForTimeout(500);
    const trackingOnBeforeSos = await historyPage.locator("#tracking-indicator").isVisible();

    // Fire SOS from a SEPARATE page/tab (sos.html) in the same browser
    // context, simulating the real multi-page/multi-tab scenario.
    const sosPage = await context.newPage();
    sosPage.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[sos-autostop:sos] ${msg.text()}`);
    });
    sosPage.on("pageerror", (err) => pageErrors.push(`[sos-autostop:sos] ${err.message}`));
    await sosPage.goto(`${BASE}/sos.html`);
    await sosPage.click("#sos-btn");
    await sosPage.click("#sos-btn");
    await sosPage.waitForSelector("#countdown-area:not([hidden])", { timeout: 2000 });
    await sosPage.click("#cancel-btn");
    await sosPage.waitForTimeout(700); // allow the storage event to propagate to the other tab

    const trackingOnAfterCancel = await historyPage.locator("#tracking-indicator").isVisible();
    console.log(
      "Tracking was ON in one tab, auto-stopped after SOS canceled in a DIFFERENT tab (cross-tab signal works):",
      trackingOnBeforeSos === true && trackingOnAfterCancel === false
    );

    await sosPage.close();
    await historyPage.close();
    await context.close();
  }

  await browser.close();

  console.log("\n=== console.error / pageerror summary (route + history) ===");
  console.log("console.error count:", errors.length, errors);
  console.log("pageerror count:", pageErrors.length, pageErrors);

  if (errors.length || pageErrors.length) {
    process.exitCode = 1;
  }
})();

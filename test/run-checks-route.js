const fs = require("fs");
const { chromium } = require("playwright");

// See test/run-checks.js for why this exists (dev-only self-check tool,
// not part of the shipped app; not committed with playwright as a real
// dependency — see HANDOFF.md for how to re-run this).
function findChromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  try {
    const dir = `${process.env.HOME}/.cache/puppeteer/chrome`;
    const matches = fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .map((d) => `${dir}/${d}/chrome-linux64/chrome`)
          .filter((p) => fs.existsSync(p))
      : [];
    if (matches.length) return matches[0];
  } catch (_) {
    /* fall through */
  }
  return undefined;
}

(async () => {
  const errors = [];
  const pageErrors = [];
  const chromePath = findChromePath();
  const browser = await chromium.launch({
    ...(chromePath ? { executablePath: chromePath } : {}),
    args: ["--no-sandbox"],
  });

  const BASE_URL = process.env.SAFETY_NET_URL || "http://localhost:8765/index.html";

  // ---- Test 1: Safe Route Planner — real geocoding + real routing --------
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[route-planner] ${msg.text()}`);
    });
    page.on("pageerror", (err) => pageErrors.push(`[route-planner] ${err.message}`));

    await page.goto(BASE_URL, { waitUntil: "networkidle" });

    const mapRendered = await page.evaluate(() => !!document.querySelector(".leaflet-container"));
    console.log("Leaflet map rendered:", mapRendered);

    await page.fill("#route-start", "Ferry Building, San Francisco");
    await page.fill("#route-dest", "Golden Gate Park, San Francisco");
    await page.click("#find-routes-btn");

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

    const polylineCount = await page.evaluate(
      () => document.querySelectorAll("path.leaflet-interactive").length
    );
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

    await page.goto(BASE_URL, { waitUntil: "networkidle" });

    // A short route centered directly on the highest-weight mock zone
    // (data/mock-incidents.json "Demo zone K", weight 9) should score
    // noticeably lower than a route far from any zone.
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

  // ---- Test 3: opt-in route history tracking ------------------------------
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

    await page.goto(BASE_URL, { waitUntil: "networkidle" });

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

    // Move the simulated device a couple of times; watchPosition should log points.
    await context.setGeolocation({ latitude: 37.776, longitude: -122.421 });
    await page.waitForTimeout(700);
    await context.setGeolocation({ latitude: 37.777, longitude: -122.422 });
    await page.waitForTimeout(700);

    const polylinesDuring = await page.evaluate(
      () => document.querySelectorAll("path.leaflet-interactive").length
    );
    console.log("A tracking polyline is drawn on the shared map (>=1):", polylinesDuring >= 1);

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

  // ---- Test 4: SOS cancel auto-stops an active tracking session ----------
  {
    const context = await browser.newContext({
      permissions: ["geolocation"],
      geolocation: { latitude: 37.7749, longitude: -122.4194 },
    });
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[sos-autostop] ${msg.text()}`);
    });
    page.on("pageerror", (err) => pageErrors.push(`[sos-autostop] ${err.message}`));

    await page.goto(BASE_URL, { waitUntil: "networkidle" });

    await page.fill("#contact-name", "Test Contact");
    await page.fill("#contact-email", "test@example.com");
    await page.click("#contact-form button[type=submit]");

    await page.click("#start-tracking-btn");
    await page.waitForTimeout(500);
    const trackingOnBeforeSos = await page.locator("#tracking-indicator").isVisible();

    await page.click("#sos-btn");
    await page.click("#sos-btn"); // double-tap arm
    await page.waitForSelector("#countdown-area:not([hidden])", { timeout: 2000 });
    await page.click("#cancel-btn");
    await page.waitForTimeout(500);

    const trackingOnAfterCancel = await page.locator("#tracking-indicator").isVisible();
    console.log(
      "Tracking was ON before SOS, auto-stopped after SOS canceled:",
      trackingOnBeforeSos === true && trackingOnAfterCancel === false
    );

    await context.close();
  }

  await browser.close();

  console.log("\n=== console.error / pageerror summary (Phase 2) ===");
  console.log("console.error count:", errors.length, errors);
  console.log("pageerror count:", pageErrors.length, pageErrors);

  if (errors.length || pageErrors.length) {
    process.exitCode = 1;
  }
})();

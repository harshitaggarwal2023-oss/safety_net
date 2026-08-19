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

  // ---- Test 1: landing page shows SETUP state with no contact saved -----
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[landing-setup] ${msg.text()}`);
    });
    page.on("pageerror", (err) => pageErrors.push(`[landing-setup] ${err.message}`));

    await page.goto(`${BASE}/index.html`);
    const setupFormVisible = await page.locator("#contact-form").isVisible();
    const welcomeBackVisible = (await page.locator("#contact-card h2").textContent()).includes("Welcome back");
    console.log("Landing page shows the setup form (not welcome-back) when no contact is saved:", setupFormVisible && !welcomeBackVisible);

    const featureLinksCount = await page.locator(".feature-card").count();
    console.log("Landing page shows 5 feature cards (SOS/Route/History/Check-in/Chat):", featureLinksCount === 5);

    await context.close();
  }

  // ---- Test 2: landing page shows WELCOME-BACK state with a contact saved
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[landing-welcome] ${msg.text()}`);
    });
    page.on("pageerror", (err) => pageErrors.push(`[landing-welcome] ${err.message}`));

    await page.goto(`${BASE}/index.html`);
    await page.fill("#contact-name", "Jordan");
    await page.fill("#contact-email", "jordan@example.com");
    await page.click("#contact-form button[type=submit]");

    const headingText = await page.locator("#contact-card h2").textContent();
    console.log("After saving, heading switches to welcome-back state:", headingText.includes("Welcome back"));
    const statusText = await page.locator(".contact-status").textContent();
    console.log("Welcome-back state shows the saved contact's name:", statusText.includes("Jordan"));
    const changeBtnVisible = await page.locator("#contact-card button", { hasText: "Change contact" }).isVisible();
    console.log("'Change contact' option is present:", changeBtnVisible);

    // Reload — should STILL show welcome-back (this is the "stay logged
    // in via localStorage" behavior the spec asked for, re-verified after
    // a fresh page load rather than only checking the in-memory re-render).
    await page.reload();
    const headingAfterReload = await page.locator("#contact-card h2").textContent();
    console.log("Welcome-back state persists across a reload (localStorage, not just in-memory):", headingAfterReload.includes("Welcome back"));

    // Change contact -> shows prefilled setup form -> cancel returns to
    // welcome-back without altering the saved contact.
    await page.click("#contact-card button:has-text('Change contact')");
    const prefillName = await page.locator("#contact-name").inputValue();
    console.log("'Change contact' prefills the existing name:", prefillName === "Jordan");
    await page.click("#contact-card button:has-text('Cancel')");
    const backToWelcome = (await page.locator("#contact-card h2").textContent()).includes("Welcome back");
    console.log("Cancel from the change-contact form returns to welcome-back without saving anything new:", backToWelcome);

    await context.close();
  }

  // ---- Test 3: XSS payload in the landing-page contact name renders inert
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[landing-xss] ${msg.text()}`);
    });
    page.on("pageerror", (err) => pageErrors.push(`[landing-xss] ${err.message}`));

    await page.goto(`${BASE}/index.html`);
    await page.fill("#contact-name", '<img src=x onerror="window.__landingXss=true">Robin');
    await page.fill("#contact-phone", "+1 555 987 6543");
    await page.click("#contact-form button[type=submit]");

    const xssFired = await page.evaluate(() => window.__landingXss === true);
    console.log("XSS payload in contact name did not execute on landing page:", !xssFired);
    const rendersAsText = (await page.locator(".contact-status strong").textContent()).includes("<img");
    console.log("Payload rendered as inert text (contains literal tag characters, not parsed):", rendersAsText);

    await context.close();
  }

  // ---- Test 4: "continue where you left off" resume banner (sessionStorage)
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[resume-banner] ${msg.text()}`);
    });
    page.on("pageerror", (err) => pageErrors.push(`[resume-banner] ${err.message}`));

    await page.goto(`${BASE}/index.html`);
    const bannerBeforeVisit = await page.locator(".resume-banner").count();
    console.log("No resume banner on a fresh tab before visiting any feature page:", bannerBeforeVisit === 0);

    await page.goto(`${BASE}/route.html`);
    await page.goto(`${BASE}/index.html`);
    const bannerAfterVisit = await page.locator(".resume-banner a").count();
    console.log("Resume banner appears after visiting a feature page in this tab:", bannerAfterVisit === 1);
    const bannerHref = await page.locator(".resume-banner a").getAttribute("href");
    console.log("Resume banner links to the last-visited feature page:", bannerHref === "route.html");

    // sessionStorage is tab-scoped: a brand NEW context (like a new tab
    // starting fresh / private window) should NOT see the hint.
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(`${BASE}/index.html`);
    const bannerInNewContext = await page2.locator(".resume-banner").count();
    console.log("A separate browser context/tab does not see another tab's session hint (sessionStorage is tab-scoped, not shared):", bannerInNewContext === 0);
    await context2.close();

    await context.close();
  }

  await browser.close();

  console.log("\n=== console.error / pageerror summary (landing page) ===");
  console.log("console.error count:", errors.length, errors);
  console.log("pageerror count:", pageErrors.length, pageErrors);

  if (errors.length || pageErrors.length) {
    process.exitCode = 1;
  }
})();

# 🛟 Safety Net

Personal safety web app for students, commuters, and anyone walking home
alone or through an unfamiliar area. Hackathon build, no backend, no build
step — open `index.html` and it runs.

**Phase 1:** SOS panic button. **Phase 2:** Safe route planner + opt-in
route history. **Phase 3 (this session, final):** Check-in / dead-man's
switch, and a chat-style distress detector. All three phases share one SOS
send pipeline — nothing is duplicated. See `HANDOFF.md` for full build
history and internals.

## Run it

No build step, no npm install, no dependencies to fetch. Just serve the
static files:

```bash
cd safety-net
python3 -m http.server 8765
# then open http://localhost:8765/index.html
```

Any static file server works (`npx serve`, VS Code Live Server, etc.).

## What's in the app

| Feature | What it does |
|---|---|
| **Trusted contact + SOS button** | Press-and-hold or double-tap to arm a 5s cancelable countdown. Fires a location-tagged alert to your trusted contact via email/SMS app (or real email if EmailJS is configured — see below). |
| **Safe route planner** | Enter a start/destination, see up to 3 walking routes on a live map with a demo "safety score." |
| **Opt-in route history** | Off by default. Logs your path on-device while walking, only if you turn it on. |
| **Check-in timer** | Set a timer before you head out. If you don't tap "I'm safe" in time, it fires the same SOS alert automatically. |
| **Chat check-in** | Type how you're doing. Messages that look like a distress situation trigger a confirm prompt to send an SOS alert — never sent without you tapping confirm. |

## What's real vs. what's mocked

- **The SOS alert itself is real** — it's a real `mailto:`/`sms:` link (or a
  real EmailJS send, if configured) with your actual live-or-manual
  location, sent to the contact you enter. This is not a demo.
- **The safe-route "safety score" is a demo model, not real crime data.**
  It combines a time-of-day multiplier with proximity to a small,
  hand-authored, fictional set of 15 "incident zones" around San Francisco
  (`data/mock-incidents.json`, which carries its own disclaimer). It is
  **not** sourced from any police department, news outlet, or real incident
  database, and is called out in the app UI itself (the amber banner above
  the route planner). Don't rely on it for real safety decisions.
- **The chat distress detector is a hand-authored keyword/phrase list, not
  an AI model.** It looks for plain-language phrases about being followed,
  trapped, unsafe, or hurt, entirely on your device. It will miss
  paraphrased distress and can occasionally false-positive on unrelated
  text — that's exactly why it always asks for confirmation before sending
  anything, rather than firing automatically. If you are in immediate
  physical danger, contact your local emergency number directly.
- **The check-in timer's auto-fire is real** (it reuses the same SOS send
  pipeline as the button), but it only runs while the browser tab stays
  open — see Known limitations below.
- **Map tiles, routing, and geocoding are live calls to free public
  services** (OpenStreetMap, the public OSRM demo server, the public
  Nominatim demo server) — never vendored into this repo, no API key
  required, no results cached or committed.

## Privacy — please read before demoing

Nothing in this app is sent anywhere except the alert message you (or a
timer/detector, on your behalf) explicitly trigger, and only to the
trusted contact you set. Specifically:

- **Route history is opt-in and local-only.** Tracking is **off by
  default**. Nothing is recorded until you tap "Start tracking." Points are
  stored **only in your browser's `localStorage`, on your own device** —
  never sent anywhere automatically. A visible "🔴 Tracking is ON" indicator
  is shown the entire time it's active. "Stop tracking" is always as easy
  to reach as "Start tracking." "Clear route history" deletes it from
  storage immediately, not just from the screen. The only way route history
  ever leaves your browser is if you explicitly tap "Export route history,"
  which downloads a JSON file to your own device — the app itself never
  transmits it anywhere.
- **The check-in timer only stores a start time and a duration**, in
  `localStorage`, so it can survive a page reload while you're still
  walking. It's cleared as soon as you cancel it, it fires, or it times
  out. No location is logged by the timer itself.
- **Chat messages are never stored anywhere** — not in `localStorage`, not
  on a server. They exist only in the page's memory for that session and
  disappear on reload. The keyword check that scans them runs entirely in
  your browser; nothing you type is sent to a server unless you explicitly
  confirm sending an SOS alert, and even then only your location and
  contact info go out — not your typed message.
- **SOS alerts always use a fresh, independent location lookup** at the
  moment they fire. Route history, if any is stored, is never attached to
  or read by an SOS alert — the two are completely separate data paths.

## Security notes

- Every piece of user-typed or fetched text (contact info, chat messages,
  geocoder/route results) reaches the DOM via `textContent` or DOM nodes
  built with `textContent` — never `innerHTML` — so it can't execute as
  HTML/JS. This was verified with actual XSS-payload inputs in the
  automated test suites (`test/`).
- No secrets live in this repo. Optional real-email sending (EmailJS) reads
  its keys from a gitignored `env.js` (see `env.js.example`) — with none
  configured, SOS falls back to your device's own mail/SMS app, which needs
  no keys at all.
- All external calls (routing, geocoding, map tiles, EmailJS) go over
  HTTPS to services that don't require secrets to be shipped to the
  browser. See `.env.example` for why a real SMS API (Twilio) is
  intentionally *not* wired up client-side — its auth token is a real
  secret that a static, backend-free page cannot hold safely.

## Optional: real email sending via EmailJS

By default, SOS alerts (however triggered — button, check-in timeout, or
chat confirm) send through your device's own mail app (`mailto:`) or
messaging app (`sms:`) — no keys, no backend, works everywhere.

To send real email automatically instead:

1. `cp env.js.example env.js` and fill in your EmailJS `SERVICE_ID`,
   `TEMPLATE_ID`, and `PUBLIC_KEY`.
2. Uncomment the `<script src="env.js"></script>` line in `index.html`.

`env.js` is gitignored — never commit it with real values.

## Known limitations

- **Check-in timer and route tracking only run while the tab is open.**
  Both are plain browser JavaScript with no service worker — if the tab or
  browser is fully closed, no code runs, so neither can fire or log in the
  background. The check-in timer's deadline is persisted, so *reloading* an
  open tab resumes it correctly, and if you reopen the app after the
  deadline already passed, it fires immediately rather than silently
  dropping — but a closed tab is a hard limit of a backend-free static app,
  not a bug. See the `ponytail:` comments in `checkin.js` and `route.js`.
- **The chat detector is a keyword list, not language understanding** — see
  "What's real vs. mocked" above.
- **Safety scores only reflect real incident-zone data near San Francisco,
  CA** — routes elsewhere get a neutral, time-of-day-only score.
- Not manually tested on Safari/Firefox or a physical phone — developed and
  self-checked in headless Chromium only.
- All Phase 1 limitations (digit-count-only phone validation, no Twilio/SMS
  API path, `sms:` prefill inconsistency across OSes) still apply unchanged
  — see the `ponytail:` comments in `app.js` and `.env.example`.

Full build-by-build detail, including this session's self-check results,
is in `HANDOFF.md`.

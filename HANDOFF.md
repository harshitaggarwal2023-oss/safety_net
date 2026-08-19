# HANDOFF — Safety Net

Last updated: 2026-08-19 (Phase 4 session — multi-page restructure completion pass)

## What's built and confirmed working

Static, dependency-free web app, now split across **six pages** instead of
the single-page `index.html` described in the Phase 1-3 notes below:
`index.html` (landing), `sos.html`, `route.html`, `history.html`,
`checkin.html`, `chat.html` — plus shared `style.css` and
`data/mock-incidents.json`. The old single-file `app.js` and `route.js`
no longer exist; their logic was split into `nav.js`, `contact-store.js`,
`contact-widget.js`, `sos-engine.js`, `sos-page.js`, `checkin.js`,
`route-common.js`, `route-planner.js`, `route-history.js`, and `chat.js`
— see the **Phase 4** section below for exactly what moved where and why.
No backend, no build step, no npm packages required to run it. Two
external free services (no API key) are used only by the route planner:
OpenStreetMap tiles, the public OSRM demo router, and the public Nominatim
demo geocoder — all loaded/fetched live, never vendored into the repo.

The Phase 1/2/3 narrative below describes the *original single-page*
build and is kept for history — the logic it describes is still present
and unchanged in behavior, just relocated into the files named above and
in the Phase 4 section.

### Phase 1 — SOS Alert (unchanged, re-verified this session)

**Trusted contact setup**, **SOS panic button** (press-and-hold or
double-tap to arm, 5s cancelable countdown), and **fireSos()** (live
geolocation with manual fallback, plain-text alert message, copy-to-
clipboard, and send via optional EmailJS / `mailto:` / `sms:` in priority
order) all work exactly as before. Re-ran the full Phase 1 Playwright suite
(`test/run-checks.js`) after all Phase 2 changes: **0 console.error, 0
pageerror**, all assertions passed (XSS-safe contact rendering, disabled/
enabled SOS button, single-tap-doesn't-arm, double-tap/hold-to-arm, cancel,
full fire flow with geolocation granted and denied). Nothing in Phase 2
touches Phase 1's send pipeline — see the "Reused, not duplicated" note
below.

Full detail on Phase 1 internals is unchanged from before; see the SOS
section of this file's git history if you need the blow-by-blow.

### Phase 2 — Safe Route Planner + opt-in Route History (new this session)

**Safe Route Planner** (`route.js`, `#route-card` in `index.html`)
- Single shared Leaflet map (`L.map('map')`, loaded from the unpkg CDN with
  Subresource Integrity hashes — see `<head>` — not vendored into the repo,
  no tile cache committed) used by both the route planner and route history
  below.
- Enter a start and destination (free text, geocoded via the public
  Nominatim demo server) or type `lat, lng` directly, or click "Use my
  location" for the start (reuses the same `getCurrentPosition` pattern as
  `app.js`, independent instance since route.js doesn't import app.js).
- Routing via the public OSRM demo server (`router.project-osrm.org`,
  `foot` profile), up to 3 alternative routes rendered as distinct-colored
  polylines; click a route in the list to highlight it on the map.
- **Safety score per route** — `buildSafetyScore()` in `route.js`, a
  **demo scoring model only, not real crime data**: time-of-day multiplier
  (night/evening/day) × proximity to a small hand-authored
  `data/mock-incidents.json` file (15 fictional "demo zones" around San
  Francisco with a `_disclaimer` field in the JSON itself). Labeled "Safer /
  Moderate / Higher risk" with a score out of 100. This is called out three
  times: the JSON file's own disclaimer, a visible `#score-disclaimer`
  banner in the UI, and a code comment block above `buildSafetyScore()`.
  Verified via automated test that a route deliberately centered on the
  highest-weight mock zone (weight 9) scores meaningfully lower
  ("Moderate", ~64/100) than routes far from any zone (~90s, "Safer").
- All geocoder/route-derived text reaches the DOM via `textContent` or
  DOM nodes built with `textContent` (see `safePopupNode()`), never
  `innerHTML` — confirmed via an automated XSS-payload test on the start-
  location input (a `<img onerror=...>` payload renders as inert text /
  fails to geocode, does not execute).

**Opt-in Route History** (same `route.js`, `#tracking-*` elements)
- **OFF by default.** Nothing is recorded until the user explicitly clicks
  the clearly-labeled "Start tracking" button (never bundled silently into
  the route planner above).
- Uses `navigator.geolocation.watchPosition` (event-driven), **not** a
  `setInterval` poll loop, to log `{lat, lng, timestamp}` points for the
  current session.
- Stored **only** in `localStorage` (`safetyNet.routeHistory`), on-device.
  Nothing here is ever sent anywhere automatically. `fireSos()` in `app.js`
  is untouched — SOS alerts only ever use a fresh, independent
  `getCurrentPosition()` call at the moment they fire; route history and
  the SOS location are fully separate data paths with no code sharing
  beyond a stop-signal event (see below).
- Current/past routes draw as polylines on the **same** Leaflet map
  instance used by the route planner (past sessions in dashed gray, the
  live session in solid teal) — no second map was created.
- A visible `🔴 Tracking is ON` indicator (`#tracking-indicator`, pulsing
  text) shows the entire time tracking is active. "Stop tracking" is the
  same size/prominence as "Start tracking" and swaps in its place (never
  hidden behind a menu). "Clear route history" removes the `localStorage`
  key entirely — confirmed via automated test that the key reads back
  `null` afterward, not just UI-hidden.
- **Export route history** is a separate, explicit button — the only path
  by which stored history ever leaves the browser, and even then only as a
  downloaded JSON file on the user's own device (`URL.createObjectURL` +
  a synthetic `<a download>` click), never transmitted anywhere by the app.
- **Auto-stop conditions**, both verified:
  1. `document.dispatchEvent(new CustomEvent("safetynet:sos-ended"))` is
     fired from `app.js` on SOS cancel *and* after a fire attempt resolves;
     `route.js` listens and stops tracking if it's running. Confirmed via
     automated test: started tracking, armed + canceled SOS, tracking
     indicator disappeared and status read "auto-stopped because the SOS
     alert ended."
  2. A hard 4-hour ceiling (`MAX_TRACKING_MS`, marked with a `ponytail:`
     comment in `route.js`) via `setTimeout`, so a forgotten tracking
     session can never run unattended forever. Not feasible to run out a
     real 4-hour timer in this session's self-check — verified by reading
     the code path and confirming the constant/timeout wiring, not by
     letting the clock run out. See Known limitations.
- Bug found and fixed during this session's self-check: the first version
  treated *any* `watchPosition` error (including transient
  `POSITION_UNAVAILABLE`/`TIMEOUT`, GeolocationPositionError codes 2 and 3)
  as fatal and killed tracking. Real GPS/browsers emit these transiently
  even when location is fine moments later. Fixed to only hard-stop on
  code 1 (`PERMISSION_DENIED`); codes 2/3 now just update the status text
  and keep the watch running. Re-verified with a live-changing-geolocation
  Playwright test after the fix — 3 points logged across 3 position
  updates with 0 errors surfaced to the user incorrectly.

**Reused, not duplicated:**
- Same Leaflet map instance for both features (per spec).
- SOS pipeline in `app.js` is completely unmodified except for two
  `document.dispatchEvent(...)` calls (on cancel, and at the end of
  `fireSos()`) — no send-path code was touched or forked.
- `buildMapsLink()`-style reuse wasn't directly applicable (route.js needs
  a full route, not a point link), but the same "always render text via
  DOM textContent, never innerHTML" discipline from `app.js` was carried
  over verbatim into `route.js`.

### Phase 3 — Check-in dead-man's switch + chat distress detector (new this session, final)

**Check-in timer** (`checkin.js`, `#checkin-card` in `index.html`)
- User picks a duration in minutes (1-180, clamped client-side; the input
  has `novalidate` on its form since the JS clamp is the real guard). On
  "Start," requires a valid trusted contact (same `contactIsValid()` /
  `loadContact()` from `app.js`, reused directly — not reimplemented).
- Deadline is stored in `localStorage` (`safetyNet.checkin`, just
  `{deadline, durationMs}` — no location, no other data) so it survives a
  page *reload* while the tab stays open. On load: if a stored deadline is
  still in the future, the countdown resumes; if it already passed (tab was
  reloaded/reopened after the deadline), it fires immediately rather than
  silently dropping. Verified via automated test in both directions.
- "I'm safe" resets the deadline to `now + durationMs` and keeps the switch
  armed (a rolling check-in, not a one-shot timer) — verified via test that
  the active area stays visible and the countdown resets.
- "Cancel check-in" fully clears the `localStorage` key and stops the
  timer — verified.
- **On elapse, it calls `sendSosAlert("checkin-timeout")` directly** — a new
  function factored out of `app.js`'s `fireSos()` this session (see below),
  per the roadmap note from last time. No location/message/send logic is
  duplicated here.
- If a manual SOS or the chat detector fires while a check-in timer is
  running, the timer auto-cancels (listens for `safetynet:sos-ended` with
  `reason: "fired"`, same event Phase 2's tracking auto-stop already used) —
  avoids a redundant second alert firing later for no reason. Verified via
  test that check-in state clears when an SOS actually sends.
- **ponytail** (see comment above `tickInterval` in `checkin.js`): this only
  runs while the tab is open — `setInterval`/`setTimeout` can't fire in a
  closed tab or a fully suspended background page. The reload-resume and
  fire-on-late-reopen behavior above is the practical mitigation, not a full
  fix. A true "fires even with the browser fully closed" dead-man's switch
  needs a backend (a server-side scheduled job) — out of scope for a
  static, backend-free app. Same category of limitation as Phase 2's
  route-tracking-doesn't-survive-reload note, just partially better handled
  here since a timer deadline is trivial to persist and a `watchPosition`
  stream isn't.

**`app.js` refactor to support this (and the chat detector) without
duplicating the SOS pipeline:**
- `fireSos()`'s body (get contact, get location, build message, send,
  dispatch `safetynet:sos-ended`) is now `sendSosAlert(triggerReason)`, a
  standalone async function with no dependency on arm/countdown UI state.
  `fireSos()` itself is now a thin wrapper: set "SENDING…" UI, call
  `sendSosAlert("manual")`, reset to idle.
- `buildMessage()` takes an optional `triggerReason` and includes a
  human-readable line naming why the alert fired (manual button, check-in
  timeout, or chat detector) — so the person receiving the alert knows more
  than just "this fired," matching the spirit of "no secrets, full
  context" the project already had. Existing Phase 1 tests don't assert on
  that exact line's wording, so this didn't touch any expected test string.
- This is the exact refactor the previous session's roadmap note called
  for ("factor the build-message/get-location/send portion out of
  `fireSos()` into its own function first") — done, and both new Phase 3
  features call it directly rather than re-implementing any part of it.

**Chat distress detector** (`chat.js`, `#chat-card` in `index.html`)
- Entirely client-side: a hand-authored list of ~30 plain-language
  distress phrases (being followed, feeling unsafe, trapped, being hurt,
  "help me," "call the police," etc.), matched via word-boundary regex
  after normalizing apostrophes so `"don't"`/`"dont"` both match. **No
  network call, no server, nothing stored** — messages live only in page
  memory for that session. This was a deliberate scope decision (see the
  roadmap note from last time about a server being "a bigger call"): a
  backend-based classifier was not introduced, keeping the project's
  no-backend/10MB/no-secrets posture unchanged.
- **Deliberately never auto-fires.** A flagged message always renders an
  inline confirm/dismiss prompt (`chat-msg-flag` + two buttons) first — only
  tapping "Send SOS now" calls `sendSosAlert("chat-detector")`. This is the
  intentional difference from the check-in switch: a missed check-in means
  the user *couldn't* respond, so auto-firing is the point, but typed text
  from a naive keyword scanner is noisy enough that auto-firing on every
  match would risk real alert fatigue and false alarms — a confirmation
  gate is the safer design, not a corner-cut. Documented as such in
  `chat.js`'s header comment and in the UI's `#chat-disclaimer` banner,
  which also points people toward contacting emergency services directly
  for real immediate danger, since this is a keyword list, not a crisis
  tool.
- All chat text (both what the user types and the generated system/prompt
  text) reaches the DOM via `textContent` / DOM nodes built with
  `textContent`, same discipline as `app.js`/`route.js` — verified via an
  automated XSS-payload test (`<img onerror=...>` renders as an inert
  chat bubble, does not execute).
- **ponytail** (see `chat.js` header comment): this is a keyword list, not
  an NLP classifier — it will miss paraphrased distress and can
  false-positive on unrelated text (e.g. "that movie's ending scared me").
  No understanding of negation, sarcasm, or context. Upgrade path: a real
  on-device text classifier if false-positive/negative rates matter beyond
  a hackathon demo.

### Phase 4 — Multi-page restructure, landing page, "stay logged in," client-side rate/spam guards (this session)

**Multi-page split.** The single `index.html` from Phases 1-3 is now a
dedicated landing page plus five feature pages, each loading only the
shared files it needs:

| Page | Loads | Purpose |
|---|---|---|
| `index.html` | `nav.js`, `contact-store.js`, `contact-widget.js` | Landing page: trusted-contact setup, feature links, "continue where you left off" |
| `sos.html` | `nav.js`, `contact-store.js`, `sos-engine.js`, `sos-page.js`, `env.js` | Manual SOS arm/countdown/fire |
| `route.html` | `nav.js`, `route-common.js`, `route-planner.js`, Leaflet | Safe route planner |
| `history.html` | `nav.js`, `sos-engine.js`, `route-common.js`, `route-history.js`, Leaflet | Opt-in route tracking/history |
| `checkin.html` | `nav.js`, `contact-store.js`, `sos-engine.js`, `checkin.js` | Dead-man's-switch check-in |
| `chat.html` | `nav.js`, `contact-store.js`, `sos-engine.js`, `chat.js` | Chat distress detector |

`sos-engine.js` is the shared `sendSosAlert()` pipeline (get contact, get
location, build message, send, broadcast `safetynet:sos-ended`) — the
exact Phase 3 logic, unchanged, now in its own file so `sos.html`,
`checkin.html`, and `chat.html` can each include it without duplicating
or forking it. It also owns the new cross-tab signal (`storage` event +
a small localStorage key) so an SOS ending on one page/tab still reaches
listeners on another — a same-document `CustomEvent` alone stopped being
enough once these features could be open in different tabs.

**"Stay logged in" — client-side session persistence, not real
authentication.** Two separate, honestly-scoped mechanisms:
- The trusted contact record (`contact-store.js`, `localStorage` key
  `safetyNet.trustedContact`) is unchanged from Phase 1 — any page that
  needs it reads the same record, so it's never re-asked for once saved.
- `nav.js` additionally remembers the last-visited page in
  **`sessionStorage`** (tab-scoped, wiped on tab close — deliberately
  *not* `localStorage`), purely so a reload/return to the landing page
  can offer a "continue where you left off" link.

**Neither of these is a login system.** There is no password field, no
login form, and no server to authenticate against anywhere in this
project — confirmed by inspection this session (grepped every `.html`/
`.js` file for password/login UI: none found). "Stay logged in" here
means only "your saved contact and last page persist across visits on
this device," nothing more. A real login system would need a backend
this project deliberately doesn't have.

**Client-side rate-limit / spam guards — accident and abuse-*friction*,
not real rate limiting.** Three separate guards were added this session,
each marked with a `ponytail:` comment naming its actual ceiling:
1. **SOS cooldown** (`sos-page.js`, `COOLDOWN_MS = 30 * 1000`) — after a
   fire attempt resolves, the SOS button disables for 30s with a visible,
   live-updating countdown ("SOS can be armed again in Ns"), then
   re-enables automatically. Verified this session via a scripted trace:
   armed → 5s countdown → fired → disabled with countdown text starting
   at 30s → ticked down every second → re-enabled at ~35s total.
2. **Route-planner in-flight guard** (`route-planner.js`,
   `routeRequestInFlight`) — a boolean flag (not just the button's
   `disabled` attribute, which doesn't stop a form's `submit` event
   firing again via Enter-key repeat) that drops a second geocode/route
   submit while one is already in flight, so the free public OSRM/
   Nominatim demo servers don't get hit with overlapping requests from a
   double-submit.
3. **Chat confirm-prompt de-dupe** (`chat.js`, `activeConfirmPrompt`) —
   if the keyword detector re-flags text while a confirm/dismiss prompt
   from an earlier flag is still unanswered, it does not stack a second
   prompt; it appends a one-line nudge to resolve the existing one
   instead. A genuinely new flagged message after the prior one is
   resolved still always gets its own prompt.

**None of these three guards is server-side rate limiting.** All three
are `Math.random()`-free, purely-client-side, and trivially bypassed by
anyone willing to edit the page's JS or open a second browser/device —
they exist to stop *accidental* spam (mashing a button, double-submitting
a form, a keyword scanner re-triggering on repeated typing), not to
defend against a determined attacker. Real rate limiting against abuse
would need a backend to enforce server-side, same category of limitation
as the "stay logged in" note above and the pre-existing Phase 3 dead-
man's-switch tab-must-stay-open limitation. See "Known limitations"
below for what a future session would need to add a real backend for
either of these "for real."

**This session's verification (targeted, not a full re-test):**
- **Step 1 — content check of four specific pieces of Phase 4 logic**,
  read line-by-line rather than just confirmed-present-by-file-existing:
  - SOS cooldown: **present and correct**, in `sos-page.js` (the arm/
    countdown state-machine file) rather than `sos-engine.js` (the shared
    send pipeline) — the right file for it, since the cooldown is UI
    state belonging to the button, not the send logic. 30s constant,
    visible countdown text, button disabled throughout, `ponytail:`
    comment present. No change needed.
  - Route-planner double-submit guard: **present and correct** —
    `routeRequestInFlight` checked at the top of the submit handler, set
    before the fetches, cleared in a `finally` block so it resets even on
    error. No change needed.
  - Chat confirm-prompt de-dupe: **present and correct** — verified the
    "still waiting" nudge path and confirmed a second *new* flagged
    message after resolving the first still gets its own prompt. No
    change needed.
  - `nav.js`/`contact-store.js` session behavior: **present and
    correct** — `sessionStorage` (not `localStorage`) used for last-page,
    existing trusted-contact `localStorage` reused as-is, and no
    password/login UI found anywhere in the project. No change needed.
  - All four items were already correct; nothing in this file needed
    fixing.
- **Step 2 — single lightweight pass, not a full suite re-run**: served
  the app locally and scripted a click-through of every nav link on all
  six pages in both directions (no broken links, no 404s), plus a full
  timed trace of the SOS flow end-to-end (hold-to-arm → 5s countdown →
  fire → 30s cooldown with live countdown → re-enable). Both passed
  clean. `route.html`/`history.html` show CORS/`L is not defined`
  console errors in this sandbox specifically because this build
  environment's outbound network doesn't reach `unpkg.com` — same
  documented sandbox-only noise as Phase 2/3's self-checks below, not a
  code issue (confirmed no other console/page errors on any of the other
  four pages, which have no external dependencies).

## Exact run command + local URL

```bash
cd safety-net
python3 -m http.server 8765
```
Open **http://localhost:8765/index.html**. Any static server works. No
build step for either phase.

## Self-check performed

Three Playwright suites, run against the actual served app in real headless
Chromium:

- `test/run-checks.js` (Phase 1) — **re-run this session, still 0
  console.error, 0 pageerror**, all assertions pass. Confirms Phase 1 is
  unaffected by the Phase 3 changes, including the `fireSos()` refactor
  (see the Phase 3 section above) — the manual SOS flow behaves identically
  end-to-end.
- `test/run-checks-route.js` (Phase 2) — **not runnable end-to-end in
  this session's sandbox**: this build environment's outbound network
  allowlist does not include `unpkg.com` (or the OSM/OSRM/Nominatim
  hosts), so Leaflet itself fails to load (`L is not defined`) regardless
  of anything in this repo. **Confirmed `route.js` and
  `data/mock-incidents.json` are byte-for-byte unchanged from the Phase 2
  handoff** (diffed against the untouched Phase 2 archive) — nothing in
  Phase 2 was touched this session, so there is no code-level regression
  risk, but this specific suite could not be re-run green here. **Please
  re-run `test/run-checks-route.js` on a machine with normal internet
  access** to get a full green Phase 2 re-verification; it should behave
  exactly as documented in the Phase 2 section above, since nothing it
  covers was modified.
- `test/run-checks-phase3.js` (Phase 3, new) — **0 console.error, 0
  pageerror** (after filtering the same sandbox-only Leaflet/CDN noise
  described above, which the script itself documents and filters — see its
  `KNOWN_SANDBOX_NOISE` comment). Covers: check-in blocked without a valid
  trusted contact; minutes input clamps to 1-180; "I'm safe" resets the
  deadline and keeps the switch armed; "Cancel" fully clears storage; an
  elapsed timer auto-fires `sendSosAlert("checkin-timeout")` and the
  resulting message names the trigger; check-in state resumes correctly
  across a page reload; a deadline that already passed while the page was
  closed fires immediately on next load and clears storage; a normal chat
  message does not flag; a distress phrase shows a confirm/dismiss prompt;
  the dismiss path sends nothing; the confirm path calls
  `sendSosAlert("chat-detector")` and the resulting message names that
  trigger; and an XSS payload typed into chat renders as inert text.

Playwright itself is **not** committed to the repo (same policy as before —
a dev/self-check tool, not a shipped dependency). To re-run any suite on a
fresh machine: `npm install playwright` in a scratch directory outside the
repo, then `npx playwright install chromium`, then run the script with
that install on `NODE_PATH` (or install playwright locally in
`safety-net/` temporarily — just don't commit `node_modules/`).

## Known limitations / things not verified

- **This sandbox's network egress does not include `unpkg.com` (or
  OSM/OSRM/Nominatim)**, so Phase 2's `test/run-checks-route.js` could not
  be run to a green result in this environment — see the Self-check
  section above for what was verified instead (a byte-for-byte diff
  confirming `route.js` is untouched). Re-run that suite on a machine with
  normal internet access before a live demo if possible.
- **Check-in timer and route tracking both only run while the tab stays
  open** — see the `ponytail:` comments in `checkin.js` (above
  `tickInterval`) and `route.js` (above `MAX_TRACKING_MS`) for exactly what
  that does and doesn't cover. The check-in timer persists its deadline and
  does a best-effort catch-up (resume on reload, fire-if-already-elapsed on
  reopen); route tracking does not persist at all across a reload — both
  are honest static-app limits, not bugs.
- **The chat distress detector is a ~30-phrase keyword list, not a
  classifier** — will miss paraphrased distress, can false-positive on
  unrelated text. Deliberately never auto-fires (always confirms first) for
  exactly this reason — see the Phase 3 section above.
- **4-hour tracking ceiling is code-reviewed, not clock-run**: verified the
  `setTimeout(..., MAX_TRACKING_MS)` wiring and the `4 * 60 * 60 * 1000`
  constant are correct, but did not (and couldn't reasonably) let an actual
  4-hour session play out end-to-end in this session.
- **Tracking does not survive a page reload.** `watchPosition` state lives
  only in `route.js`'s in-memory variables; closing the tab or reloading
  silently ends tracking without writing a partial session. `ponytail:`
  comment left in `route.js` above `MAX_TRACKING_MS` — upgrade path is a
  Service Worker / persisted "was tracking, resume" flag if a future phase
  needs cross-reload durability.
- **OSRM/Nominatim are the free public demo servers**, not a self-hosted
  instance — fine for hackathon-scale demo traffic, not for real load. No
  client-side request queuing/backoff beyond "only fetch on explicit form
  submit." Noted in a `route.js` header comment.
- **Time-of-day risk multiplier uses fixed hour bands** (22:00-05:00 =
  night, etc.), not sunrise/sunset-aware or timezone-of-route-aware — it
  uses the browsing device's local clock. `ponytail:` comment at
  `timeOfDayMultiplier()`.
- **Mock incident zones only cover the San Francisco, CA area.** Routes
  planned anywhere else in the world get a neutral time-of-day-only score
  (no incident-density factor applies) — this is intentional (see the
  JSON file's own `_disclaimer`), not a bug, but worth knowing before
  demoing a route outside SF and wondering why every route scores high.
- **Not manually tested on Safari/Firefox or a real mobile device.**
  Headless Chromium only, same caveat as Phase 1. `watchPosition`,
  `URL.createObjectURL`, and Leaflet touch handling are all standard and
  should work, but haven't been physically verified on a phone (the
  primary real-world use case for both SOS and route tracking).
- **All pre-existing Phase 1 limitations still apply unchanged** — `sms:`
  fallback untested end-to-end, EmailJS path inert without `env.js`, phone
  validation is digit-count only, no backend so no Twilio path. See the
  `ponytail:` comments in `app.js` and `.env.example` for those, unchanged
  from before.

## Repo size / branch

Checked this session, after the Phase 4 restructure:
- `du -sh .` (repo root, including `.git`): **572K**
- `du -sh .` excluding `.git`: **244K**
- Both are far under the 10MB constraint, with a lot of headroom.
- `git branch -a`: **exactly one branch, `main`** — confirmed.

(`node_modules/` lives in the *outer* `webapp/` directory, which is
unrelated Cloudflare/Vite scaffolding, not part of this project — see
the top of this file. It's excluded from the figures above and must
never be committed or zipped alongside `safety-net/`.)

## Status: four phases complete — SOS, route planner, check-in/chat, multi-page restructure

Phase 1 (SOS), Phase 2 (safe route planner + opt-in route history), Phase 3
(check-in dead-man's switch + chat distress detector), and now Phase 4
(multi-page restructure, landing page, client-side session persistence,
client-side rate/spam guards) are all built, wired together through the
shared `sendSosAlert()` pipeline, and self-checked — Phases 1-3 via the
Playwright suites described above, Phase 4 via this session's targeted
content read-through plus a single scripted nav/SOS-cooldown pass (see the
Phase 4 section). There is no further planned roadmap in this handoff; see
"Known limitations" throughout this document, plus the Phase 4 section's
honest breakdown of what "stay logged in" and the client-side rate/spam
guards do and don't cover, for what a *future* session would need a real
backend to do "for real" (true background dead-man's-switch delivery, real
SMS sending, real authentication, and real server-enforced rate limiting
being the biggest ones — every session so far has deliberately deferred
introducing a server as a non-incidental decision).

# Browser Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Chrome/Edge (Manifest V3) extension that intercepts browser downloads, captures the cookies/Referer/User-Agent needed to avoid the 403-on-replay problem the whole project exists to fix, and hands the download off to the core app's local HTTP server.

**Architecture:** A Manifest V3 extension with a background service worker that listens for `chrome.downloads.onDeterminingFilename`, cancels the browser's native handling, reads the originating tab's cookies for that URL's domain via `chrome.cookies`, and POSTs the capture to the core app's local server (built in the core-app plan). An options page handles one-time pairing to obtain the auth token, stored via `chrome.storage.local`.

**Tech Stack:** Manifest V3 (`background` service worker, `options_page`), vanilla JS, `chrome.downloads`, `chrome.cookies`, `chrome.storage.local`, `fetch`.

**Spec:** `docs/superpowers/specs/2026-11-12-download-manager-design.md`

**Depends on:** `docs/superpowers/plans/2026-11-12-core-app.md` Task 8 (the local handoff server: `GET /ping`, `POST /pair`, `POST /downloads` on `127.0.0.1:57431`) must be running to test end-to-end handoff; extension-only tasks can be tested against a stub server.

## Global Constraints

- Chrome and Edge only for v1 (both Chromium/Manifest V3) — no Firefox/Safari work (spec: explicit non-goal).
- Captured cookies/headers must only ever be sent to the local app (`127.0.0.1:57431`), never logged or sent anywhere else.
- No Chrome Web Store publishing step in this plan — shipped as a developer-mode "load unpacked" extension, consistent with this being the user's own personal tool, not a distributed product (builder's call; not fixed by the spec, flagged here as a deliberate scope decision, not an oversight).

## Review Focus

- The user already has another download manager (FDM) or the browser's own default handling active — the extension's interception must not silently break downloads if the core app isn't running (falls back to letting the browser handle it, not losing the download).
- A capture happens before pairing has completed (no token yet) — the handoff attempt must fail safely (no crash, no download lost — browser's native download proceeds instead).
- The originating tab has no cookies for that domain (anonymous/public link) — the handoff payload must still be sent successfully with an empty cookie string, not blocked or errored.
- The core app isn't running at all when a download is captured (`/ping` unreachable) — the extension must let the browser download the file natively rather than silently discarding it.
- Two downloads captured back-to-back before pairing/token lookup resolves — both must still be handed off correctly, not racing on `chrome.storage.local` reads.

---

## Task 1: Extension scaffold + options page skeleton

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/background.js`
- Create: `extension/options.html`, `extension/options.js`
- Create: `extension/icons/` (placeholder icon files)

**Interfaces:**
- Produces: a loadable Manifest V3 extension with permissions `downloads`, `cookies`, `storage`, host permission `http://127.0.0.1/*`; an options page reachable from `chrome://extensions`; a background service worker file that is currently a no-op (`console.log('background worker loaded')`).

- [ ] **Step 1: Write `extension/manifest.json`**

`manifest_version: 3`, `name`, `version`, `permissions: ["downloads", "cookies", "storage"]`, `host_permissions: ["http://127.0.0.1/*"]`, `background: { service_worker: "background.js" }`, `options_page: "options.html"`, `icons`.

- [ ] **Step 2: Write placeholder `background.js`, `options.html`, `options.js`**

- [ ] **Step 3: Verify manually**

In Chrome, go to `chrome://extensions`, enable Developer mode, "Load unpacked", select `extension/`. Expected: extension loads with no errors; opening its options page shows the placeholder page; the service worker console shows the log line.

- [ ] **Step 4: Commit**

```bash
git add extension/manifest.json extension/background.js extension/options.html extension/options.js extension/icons
git commit -m "feat: scaffold Manifest V3 extension"
```

---

## Task 2: Pairing flow (options page)

**Files:**
- Modify: `extension/options.html`, `extension/options.js`

**Interfaces:**
- Produces, in `options.js`:
  - `async function checkAppRunning(): Promise<boolean>` — `fetch('http://127.0.0.1:57431/ping')` with a short timeout; `true` only on a `200` response with body `"ok"`, `false` on any error/timeout.
  - `async function pair(): Promise<{ok: boolean, error?: string}>` — `POST http://127.0.0.1:57431/pair`; on `200`, stores the returned token via `chrome.storage.local.set({ dmToken: token })` and returns `{ok: true}`; on `403` (already paired elsewhere) or network failure, returns `{ok: false, error: '...'}` without touching storage.
  - The options page shows a status line driven by `checkAppRunning()` ("App not running" / "App running") and a "Pair" button wired to `pair()`, disabled once `chrome.storage.local.get('dmToken')` already resolves to a stored token (shows "Paired" instead).

- [ ] **Step 1: Implement `checkAppRunning` and `pair` in `options.js`, and wire them into the page per the Interfaces block**

- [ ] **Step 2: Verify manually**

With the core app (from the core-app plan) running: open the options page, confirm it shows "App running", click "Pair", confirm it flips to "Paired" and `chrome.storage.local.get('dmToken')` (checked via the extension's service worker console) returns a non-empty string. Reload the options page; confirm it still shows "Paired" without re-pairing. With the core app stopped, confirm the page shows "App not running" and the Pair button surfaces a clear error if clicked.

- [ ] **Step 3: Commit**

```bash
git add extension/options.html extension/options.js
git commit -m "feat: add one-time pairing flow to options page"
```

---

## Task 3: Download interception + cookie/header capture

**Files:**
- Modify: `extension/background.js`

**Interfaces:**
- Consumes: `dmToken` from `chrome.storage.local` (Task 2).
- Produces, in `background.js`:
  - `async function captureHeaders(tabId: number, url: string): Promise<{cookieHeader: string, referer: string, userAgent: string}>` — reads cookies for `url`'s domain via `chrome.cookies.getAll({url})`, joins them as a `name=value; name2=value2` cookie header string (empty string if none); reads `referer`/`userAgent` from the triggering tab where available (empty string if unavailable).
  - A `chrome.downloads.onDeterminingFilename` listener that, for each new download: calls `captureHeaders`, builds the handoff payload (Task 4's `sendToApp`), and if the handoff succeeds, calls `suggest({filename: downloadItem.filename, conflictAction: 'uniquify'})` after also calling `chrome.downloads.cancel(downloadItem.id)` so the browser does not also save the file itself. If the handoff fails for any reason (see Task 4), the listener calls `suggest()` with no arguments so the browser's native download proceeds unmodified.

- [ ] **Step 1: Implement `captureHeaders` and the `onDeterminingFilename` listener per the Interfaces block**

- [ ] **Step 2: Verify manually**

With the app running and paired, click a direct download link on a site you're logged into (e.g. a file behind a session cookie). Expected: the browser's own download bar does not show the file downloading; the core app's queue (from the core-app plan's UI) shows a new entry for that URL that completes successfully. Stop the core app and click another download link; expected: the browser downloads it natively, unaffected.

- [ ] **Step 3: Commit**

```bash
git add extension/background.js
git commit -m "feat: intercept downloads and capture cookies/referer/user-agent"
```

---

## Task 4: Handoff POST to the core app

**Files:**
- Modify: `extension/background.js`

**Interfaces:**
- Consumes: `captureHeaders` (Task 3); the core app's `POST /downloads` contract from `docs/superpowers/plans/2026-11-12-core-app.md` Task 8.
- Produces: `async function sendToApp(url: string, filename: string, headers: {cookieHeader: string, referer: string, userAgent: string}): Promise<boolean>` — reads `dmToken` from `chrome.storage.local`; if absent, returns `false` immediately (no fetch attempted). Otherwise `POST http://127.0.0.1:57431/downloads` with header `X-Dm-Token: <dmToken>` and JSON body `{"url": url, "filename": filename, "headers": {"Cookie": headers.cookieHeader, "Referer": headers.referer, "User-Agent": headers.userAgent}}`; returns `true` only on a `201` response, `false` on any other status or network error (including the app not running).

- [ ] **Step 1: Implement `sendToApp` per the Interfaces block and call it from Task 3's listener in place of the placeholder handoff call**

- [ ] **Step 2: Verify manually**

Repeat Task 3's manual verification, additionally confirming (via the core app's UI) that the completed download's content matches what the original link would have produced when logged in (i.e. the cookie forwarding actually fixed an auth-gated link, not just an already-public one).

- [ ] **Step 3: Commit**

```bash
git add extension/background.js
git commit -m "feat: hand off captured downloads to the local app"
```

---

## Task 5: Packaging for Chrome and Edge (sideload)

**Files:**
- Create: `extension/README.md`

**Interfaces:**
- Produces: a short README describing how to load the unpacked extension in both Chrome and Edge developer mode, and where its load path is relative to the repo root.

- [ ] **Step 1: Write `extension/README.md`** covering: enabling Developer mode in `chrome://extensions` and `edge://extensions`, "Load unpacked" pointed at the `extension/` directory, and a note that no Web Store listing exists for v1 — this is a personal/sideloaded install.

- [ ] **Step 2: Verify manually**

Load the unpacked extension in Edge (in addition to the Chrome verification already done in Tasks 1–4) and repeat Task 4's manual check there.

- [ ] **Step 3: Commit**

```bash
git add extension/README.md
git commit -m "docs: add sideload instructions for Chrome and Edge"
```

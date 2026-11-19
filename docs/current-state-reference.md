# Download Manager — Current Features & UI Reference

Reference doc capturing the app's current feature set and current visual
appearance, as a baseline for redesign work. Written 2026-11-15, reflects
the codebase at that point (desktop app + browser extension).

---

## 1. What this product is

A personal, two-part download manager:

1. **Desktop app** (Tauri/Rust + a plain HTML/JS webview, no framework) —
   the actual download engine, queue, and UI. Runs a local HTTP server on
   `127.0.0.1:57431` so the browser extension can hand off work to it.
2. **Browser extension** (Chrome/Edge, Manifest V3, sideloaded/unpacked) —
   captures downloads from the browser and video URLs from hover, and
   sends them to the desktop app.

No mobile app, no cloud sync, no accounts — everything is local to one
machine.

---

## 2. Feature inventory

### 2.1 Core download manager (desktop app)
- Add a download by pasting a URL (+ optional custom filename).
- Multi-segment/multi-threaded HTTP download engine, with automatic
  fallback to a single stream when the server doesn't support ranged
  requests.
- Pause / Resume.
- Retry a failed download (keeps its original headers).
- Cancel (removes partial files).
- Remove a finished download from the list — optionally deleting the file
  from disk too (confirmation prompt).
- Per-download speed limit (bytes/sec), settable live while downloading.
- Global default speed limit (Settings), applied to new downloads
  including ones handed off from the browser.
- Settings: download folder, max concurrent downloads (both take effect
  on next app start), default speed limit (applies immediately).
- Queue view: one row per download, live progress (%, bytes), status text,
  error message on failure.
- State persists across app restarts (queue, not progress mid-segment).
- Runs in the system tray; closing the window hides it rather than
  quitting (tray icon still shows it as running).
- Autostart at login (enabled by default).

### 2.2 Browser extension — download capture
- Intercepts every browser-initiated download (`chrome.downloads`),
  captures its cookies/referer/user-agent, and hands it to the desktop
  app's queue instead of letting the browser save it natively.
- Falls back to the browser's own native download whenever the app isn't
  running, isn't paired, or the handoff fails/times out — a download is
  never lost, only not accelerated.
- Deduplicates double-clicks: the same URL triggered twice within 2
  seconds is treated as one download, not two (the second browser-level
  download is canceled outright).
- Broad host permissions (`*://*/*`) + `cookies` — documented, accepted
  tradeoff for a personal sideloaded tool (see extension README).

### 2.3 Browser extension — video/social-platform extraction
- Hovering a `<video>` element (≥200×150px, visible) on any page shows a
  floating "Download" button pinned to its corner.
- Clicking it sends the page's URL (resolved fresh at click time, never
  cached — the fix for a real IDM bug the user hit: clicking the wrong
  video after an in-page navigation) to the app, which probes it with
  `yt-dlp`.
- The app's queue then shows that job awaiting a **resolution/format
  choice** (dropdown of available formats + a Download button) instead of
  a progress bar.
- Once a format is picked, the app downloads + merges (via `ffmpeg`) the
  chosen format, shown as a normal progress row afterward.
- `yt-dlp` and `ffmpeg` binaries are fetched and managed automatically by
  the app (first use), with a manual **"Check for yt-dlp update"** button
  in Settings for when a site's extractor starts failing (common — sites
  like YouTube change often).
- Guards against stale targets on SPA sites (YouTube etc.): re-validates
  the hovered element is still the one under the button at the moment of
  the click, re-scans on DOM mutation/navigation.
- Cookies are deliberately **not** forwarded to `yt-dlp` (a real,
  logged-in YouTube cookie currently breaks `yt-dlp`'s own format
  resolution upstream) — public videos work; private/members-only ones
  currently don't, until that's fixed upstream.

### 2.4 Pairing (extension ↔ app)
- Trust-on-first-use: whichever extension install calls `/pair` first
  gets the only token: the app persists "paired" across restarts.
- **Auto-pairs lazily** on the first download/extraction attempt — no
  manual step required for the common case.
- Manual **"Pair"** button in the extension's options page remains as a
  fallback (e.g. the app wasn't running yet on first try).
- **"Forget pairing"** button to reset this extension install's stored
  token (for recovering from a moved/reinstalled extension).
- Options page also shows whether the app is currently reachable
  ("App running" / "App not running").

### 2.5 Explicit non-goals (as currently scoped)
- No torrent support (lowest priority on the roadmap; a competing tool is
  still used for this).
- No shortlink-skipping or landing-page "click through to real download"
  automation (parked idea, not built).
- No generic HLS/DASH/blob video sniffing outside of what `yt-dlp`
  already supports per-site.

---

## 3. Current UI — desktop app window

Plain HTML/CSS/JS, no component framework, no design system. One window,
dark theme only (no light mode), fixed system-ui sans-serif font.

### 3.1 Color tokens (`src/styles.css`)
| Token | Value | Used for |
|---|---|---|
| `--bg` | `#1e1e1e` | Window background |
| `--bg-panel` | `#2a2a2a` | Panels, buttons, rows |
| `--fg` | `#eee` | Primary text |
| `--fg-muted` | `#999` | Labels, hints, meta text |
| `--accent` | `#4a9eff` | Progress bar fill, button hover border |
| `--border` | `#3a3a3a` | All borders, progress track |
| `--danger` | `#e06c75` | Error text |

Buttons: 1px border, 4px radius, `--bg-panel` fill, hover = accent-colored
border (no fill change). Panels: `--bg-panel` fill, 1px border, 6px
radius, 1rem padding. Everything is quite tight/compact — small font
sizes (0.8–1.25rem range), minimal whitespace, no icons anywhere (text
labels only), no illustrations, no empty-state graphic (just a muted
one-line sentence).

### 3.2 Layout — main window

```
┌──────────────────────────────────────────────────────────────┐
│ Download Manager                 [Add Download] [Settings]   │  <- header
├──────────────────────────────────────────────────────────────┤
│                                                                │
│   (Add/Settings panel renders HERE, pushing the queue down,   │
│    when open — see 3.3/3.4. Only one open at a time.)         │
│                                                                │
│   No downloads yet.                     <- shown when empty  │
│                                                                │
│   ┌────────────────────────────────────────────────────────┐ │
│   │ my-video.mp4                                            │ │  <- one row
│   │ ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░ (progress bar)  │ │
│   │ Downloading — 12.3 MB / 48.0 MB                          │ │
│   │ [Limit B/s___] [Set]          [Pause] [Cancel] [Remove] │ │
│   └────────────────────────────────────────────────────────┘ │
│   ┌────────────────────────────────────────────────────────┐ │
│   │ Impractical Jokers: ...truTV                             │ │  <- extract job
│   │ [ 720p ▾ ] [Download]                                    │ │     awaiting format
│   │ AwaitingFormatChoice                                     │ │
│   │                                [Cancel]           [Remove]│ │
│   └────────────────────────────────────────────────────────┘ │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

Rows for a plain HTTP download and a yt-dlp "extract" job share the exact
same row shell and are interleaved in one list, distinguished only by
their content:
- **Normal row:** title, determinate/indeterminate progress bar, "Status —
  downloaded/total" meta line, optional red error line, speed-limit mini
  form, status-dependent action buttons (any of Pause / Resume / Retry /
  Cancel / Remove).
- **Extract-job row awaiting a format choice:** the progress bar area is
  swapped for a format `<select>` + "Download" button; speed-limit form is
  always hidden (no such feature for extract jobs); actions are a subset
  of Cancel / Retry / Remove.
- Every other extract-job status (Probing, Downloading, Completed,
  Failed, Canceled) looks like a normal progress row again, just with the
  job's video title (falls back to its source URL if no title yet)
  instead of a filename.

### 3.3 "Add Download" panel (toggled by header button)
```
┌ Add Download ──────────────────────────────┐
│ URL                                         │
│ [https://example.com/file.zip____________]  │
│ Filename (optional)                         │
│ [file.zip_________________________________] │
│ (error text here, red, only on failure)     │
│                               [Add] [Cancel]│
└──────────────────────────────────────────────┘
```

### 3.4 "Settings" panel (toggled by header button)
```
┌ Settings ───────────────────────────────────────────────┐
│ Download folder                                          │
│ [C:\Users\...\Downloads__________________________]       │
│ Max concurrent downloads                                  │
│ [3_______]                                                │
│ Default speed limit, bytes/sec (optional, 0 = no limit)   │
│ [No limit___]                                             │
│ Download folder and max concurrent downloads take effect  │
│ the next time the app starts. The speed limit applies     │
│ immediately, including browser-extension downloads.       │
│ [Check for yt-dlp update]   (status text appears here)     │
│ (error text here, red, only on failure)                   │
│                                        [Save] [Cancel]    │
└────────────────────────────────────────────────────────────┘
```

Both panels are plain forms: labels stacked above full-width inputs, a
hint line in muted gray, error line in red (hidden unless there's an
error), two buttons bottom-right (primary action + Cancel).

---

## 4. Current UI — browser extension

### 4.1 Hover-to-download button (on any web page, over a `<video>`)
A single floating pill button, created once per page and repositioned to
track whichever video is currently hovered (shadow DOM, so host-page CSS
can't interfere with it):

```
                                   ┌──────────┐
   ╔═══════════════════════╗      │ Download │  <- pinned near
   ║                       ║      └──────────┘     top-right corner
   ║      <video>          ║                        of the video,
   ║                       ║                        appears on hover
   ╚═══════════════════════╝
```
- Style: dark pill, `rgba(17,17,17,0.88)` background, white text, 1px
  translucent white border, 4px radius, ~12px semibold text, 5px/10px
  padding. No icon, text-only.
- Label cycles through states on click: `Download` → `Sending…`
  (disabled) → `Sent` or `Failed` (reverts to `Download` after ~1.5s).
- No other visual feedback beyond that label change — no toast, no modal.

### 4.2 Options page (`extension/options.html`)
Completely unstyled — no CSS file at all, plain browser default styling
(black text on white, default serif/sans body font depending on browser,
left-aligned, default button chrome):

```
Download Manager
Status: App running

[Pair]                 <- disabled when already paired, shows "Paired"
(pairing error text, red, inline style, only on failure)
―――――――――――――――――――――――――――――――――――――――――――――――――――
If this extension was moved/reinstalled and can no longer
pair (the app still thinks the old install is paired), or
the app re-paired with a different extension, use this to
forget this extension's stored token and show the Pair
button again.

[Forget pairing]
(forget-status text appears here after clicking)
```

This is the single roughest part of the current UI — it's a functional
settings page with zero visual design applied (default `<h1>`, `<p>`,
`<hr>`, `<button>` rendering). Auto-pairing (see 2.4) means most users
will now rarely even open this page, but it's still the only place to see
app-reachability status, re-pair manually, or forget pairing.

---

## 5. Summary of the biggest design gaps (for whoever designs next)
- No visual identity at all — no logo/wordmark treatment beyond a plain
  `<h1>` text, no icon set beyond the four PNG app icons.
- No light theme — desktop app is dark-only; extension options page is
  unstyled (effectively "light" by browser default, inconsistent with the
  app).
- Extension options page has had literally no design pass — it's the
  roughest surface in the whole product.
- No empty/loading/success state design beyond a single muted sentence —
  no illustration, no onboarding for first-time pairing/setup.
- Download rows and extract-job rows are functionally rich (many
  statuses, inline forms, dynamic action sets) but visually flat — every
  row looks the same regardless of kind or state beyond a status word and
  a progress bar.

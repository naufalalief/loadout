# Design: All-in-One Download Manager (Windows, Tauri/Rust)

## Intent & Why

The user used IDM, then switched to FDM after IDM's licensing started requiring cracks on
every update. FDM is "good enough" but has real friction: a reproducible bug where Pixeldrain
downloads fail with 403 Forbidden and require an app restart to recover, plus other
unspecified annoyances. Separately, the user has a recurring, currently-unmet need: many
streaming sites offer no download button at all, and today the user simply gives up rather
than fighting for the file. Downloading from YouTube/Facebook/X currently means routing
through slow third-party web tools.

The goal is a native Windows download manager that (a) is a credible FDM replacement for
everyday link downloading, with a companion browser extension that auto-captures download
links the way IDM/FDM do, and (b) later grows into solving the "no download button" and
social-platform download problems in one app, so the user stops needing separate workarounds.

## Goals (v1 scope)

- A native Windows desktop app that functions as a general-purpose download manager:
  - Multi-segment/multi-threaded HTTP(S) downloads for speed.
  - Pause / resume.
  - Automatic retry on failure.
  - Per-download speed limiting (no global/shared bandwidth cap in v1 — user prioritized
    per-download only, deferring the harder shared-limiter design).
  - A download queue (controls how many downloads run concurrently; others wait).
- **App lifecycle: tray-resident background process**, auto-starting with Windows (same
  model as FDM/IDM). The background process is lightweight and always listening for the
  extension's handoffs; the main UI window opens on demand — when the user opens it from the
  tray icon, or when a new download needs a confirmation popup — rather than the whole app
  booting fresh each time. This avoids extension-handoff latency and keeps downloads running
  even when the window is closed, while keeping "feels fast" scoped to window open time, not
  cold-start time. (User confirmed after builder's recommendation.)
- A browser extension (Chromium-based: Chrome/Edge) that:
  - Detects downloadable links/files the browser would otherwise handle itself.
  - Hands the link off to the desktop app, which shows a popup/dialog to confirm and start
    the download (same interaction pattern as IDM/FDM).
- A UI that is simple to configure and visually clean — this is a stated anti-goal trigger,
  not a nice-to-have.
- Startup time and perceived download speed that feel fast, not heavy (explicit reaction
  against Electron-style heavier apps).

## Non-goals (v1)

- Grabbing video from streaming sites that have no download button (sniffing in-page
  media/HLS/DASH/blob streams). This is the clear, prioritized **next phase**, not v1 — but
  the architecture should not make it hard to add later (see "Future phases").
- Direct "paste a YouTube/Facebook/X/Instagram URL and extract the video" feature. Also a
  future phase, not v1.
- Torrent support. Lowest priority of everything discussed; FDM already covers this
  adequately for the user today. Not in v1, and no commitment yet on when/if it's added.
- macOS build. Explicitly deferred; Windows ships first. The tech stack choice (Tauri) keeps
  a later macOS port realistic, but no Mac-specific work happens in this phase.
- Firefox/Safari extension support. Chromium (Chrome/Edge) only for v1, since they share an
  extension base (Manifest V3) and cover the user's actual browser usage.

## Anti-goals (would make v1 a failure even if "it works")

These came directly from the user describing why they'd abandon a tool like this:

1. **Fiddly configuration.** If using it day-to-day requires tuning settings, it's a failure.
   Sensible defaults must work out of the box.
2. **Feels slow.** If downloads don't noticeably benefit from multi-segmenting, or the app is
   sluggish to open, it has failed its core reason for existing.
3. **Messy/cluttered UI.** A disorganized or confusing interface is an immediate failure
   condition for this user, independent of functionality.

## Constraints

- Must not require piracy/cracking to use — this is explicitly why the user left IDM.
  Implication: no licensing scheme that pressures users toward cracks; this is a free/owned
  tool for the user's own use, not a commercial product with enforcement to design around.
- Windows-first, but implementation choices should not foreclose a macOS port later.
- Browser integration must follow the established UX pattern the user already knows from
  IDM/FDM (extension intercepts, app pops up) rather than a manual paste-link-only flow.

## Decisions already made (by the user, in brainstorming)

- Browser integration model: **extension-driven capture**, not manual paste. (User's choice,
  made explicitly to avoid friction: "pengennya pake ekstensi aja biar ga ribet amat.")
- Platform order: **Windows first**, macOS later.
- v1 feature floor: pause/resume, retry, speed limiter, queue — explicitly requested by name.
  Beyond that, "detail terserah lu" (details are the builder's call).
- Speed limiter scope: **per-download only**, no global/shared cap in v1 (user's explicit
  priority call after being offered the choice).
- App lifecycle: **tray-resident, auto-start with Windows**, main window opens on demand
  (user confirmed builder's recommendation).

## Decisions made by the builder (Claude), stated explicitly

- **Tech stack: Tauri, with Rust powering the download engine and app backend, and a
  lightweight web-based frontend rendered in the OS-native webview (not a bundled Chromium
  like Electron).**
  - Why: the user has no Rust experience and deferred the choice entirely ("up to u aja").
    Tauri was chosen because:
    - App startup and memory footprint stay low since it reuses the OS's native webview
      instead of bundling a full Chromium runtime (direct response to the "not too heavy"
      requirement).
    - Rust gives a fast, safe foundation for concurrent/segmented HTTP downloads (async I/O,
      no GC pauses affecting throughput).
    - A Rust/Tauri core ports to macOS with substantially less rework than a Windows-only
      native stack (WinUI/WPF) would, supporting the stated future direction.
  - This is the builder's call, not something the user evaluated against alternatives — flag
    it during the builder-check / review step as a decision worth a sanity check.
- **Browser extension target: Chromium-based browsers only (Chrome, Edge) for v1,** since
  they share Manifest V3 and cover typical Windows usage. Firefox/Safari are not v1 targets.
- **Extension ↔ app communication:** the app should expose a local interface (e.g., a
  localhost HTTP/WebSocket endpoint or native messaging host) for the extension to hand off
  captured download links. Exact transport is an implementation detail for the plan, not
  fixed here.
- **Handoff payload must include more than the bare URL: cookies, Referer, and User-Agent
  from the capturing tab, forwarded to the app's HTTP engine as per-download overrides.**
  This directly targets the motivating bug: file hosts like Pixeldrain commonly return 403
  on download links when the request is replayed without the browser's session
  cookie/Referer/UA. Shipping v1 with URL-only handoff risks reproducing the exact failure
  class this project exists to fix, just against a different host. The download engine's
  HTTP client needs a per-request header/cookie override path from day one, not as a
  later add-on. Tradeoff to flag: this means the app temporarily holds session cookie data
  for the duration of the download — scope it to in-memory, per-download use, never
  persisted or logged, as a privacy baseline. (Builder's call; flagged here rather than
  asked, since it follows directly from the stated motivation for the whole project.)
- **Folder/category organization, detailed UI layout, and exact queue/concurrency defaults**
  are left to the implementation plan — the user explicitly deferred these ("detail terserah
  lu").

## What's left to the builder / implementation plan

- Concrete Tauri + Rust project structure and chosen crates for HTTP downloading (e.g.
  range-request segmentation, checksum/retry handling).
- Extension manifest, permissions, and the exact capture mechanism (webRequest/downloads API)
  for Chrome/Edge.
- The local transport between extension and app (port/protocol, security — e.g. only
  accepting connections from localhost, not exposing it externally).
- UI structure: main window layout (queue list, add-download dialog, settings), using
  whatever frontend framework pairs well with Tauri (plain HTML/CSS/JS, or a lightweight
  framework) — kept intentionally simple per the anti-goal on clutter.
- Default values for concurrency/segment count and speed limiting, and where/how the user
  changes them without it feeling "fiddly."
- Packaging/installer approach for Windows distribution.
- Test strategy for the download engine (segmented download correctness, resume-after-
  interruption, retry behavior) and for the extension handoff path.

## Future phases (explicitly out of scope now, but the design should not block them)

1. **Browser video capture** for sites without a native download button (sniffing in-page
   media streams, including HLS/DASH manifests and blob URLs where feasible).
2. **Direct social platform downloads** (YouTube, Facebook, X, possibly Instagram) built into
   the app, replacing the current third-party-web-tool workflow.
3. **Torrent support** — lowest priority; revisit only if the above phases are solid and the
   user still wants it (FDM already serves this need today).

# Design: Video & Social-Platform Downloads (YouTube et al.)

## Intent & Why

The original design spec (`2026-11-12-download-manager-design.md`) deferred two related
problems to "future phases": sites with no download button at all (video streaming), and
direct downloads from named social platforms (YouTube/Facebook/X/Instagram). Core-app and
the browser extension (cookie/referer handoff for ordinary file links) are both shipped,
tested, and in daily use now. This phase tackles the two deferred problems together, because
they turn out to be the same problem in practice: `yt-dlp`, a mature, actively-maintained
extractor, natively supports YouTube/Facebook/X/Instagram *and* generically covers a large
share of "video with no download button" sites in one integration — there is no need to
build a from-scratch HLS/DASH network-sniffing pipeline to get most of the value.

The user has first-hand negative experience with this feature class from IDM: IDM's
injected download button would sometimes hand off the *wrong* video — clicking it and
downloading a different video than the one actually being watched. Root cause (diagnosed in
brainstorming): YouTube is a single-page app, and a button that caches "the current video"
at the time it was shown goes stale the moment the user navigates to another video without a
full page reload. Avoiding this failure mode is a first-class design requirement here, not
an afterthought.

## Goals (this phase)

- A floating download affordance, in the spirit of IDM/FDM's video-hover button, injected by
  the browser extension's content script over `<video>` elements the user is actually
  looking at.
- One click → the app extracts available formats for *the video currently showing*, lets the
  user pick a resolution, then downloads it via `yt-dlp`, landing in the same download queue
  the rest of the app already uses.
- Coverage: YouTube first-class (the user's actual motivating case), plus whatever else
  `yt-dlp`'s extractor library happens to support for free, with no extra work required per
  site.
- `yt-dlp` itself is auto-fetched and self-updating, decoupled from app releases, so the
  feature doesn't silently rot when YouTube changes something upstream.

## Non-goals (this phase)

- Building a custom HLS/DASH manifest-sniffing pipeline for sites `yt-dlp` doesn't recognize.
  If real gaps show up in practice, that's a later phase, re-scoped against actual sites the
  user hits — not built speculatively now.
- Torrent support (unchanged from the original spec — still lowest priority, still deferred).
- Batch/playlist download (e.g. "download this whole YouTube playlist"). Single-video-at-a-
  time for this phase; revisit if it turns out to matter.
- macOS, Firefox/Safari — unchanged non-goals from the original spec.

## Anti-goals (would make this phase a failure even if "it works")

1. **Wrong video downloaded.** The single most important failure mode to design out, taken
   directly from the user's IDM experience. The button must never act on a stale reference to
   a previously-shown video after an in-page (SPA) navigation.
2. **Silent extractor rot.** If YouTube changes something and the feature just stops working
   with no clear signal, that's a failure — the user should get an actionable error, not a
   silent no-op, and there should be an easy way to refresh `yt-dlp` without reinstalling the
   whole app.
3. **Button noise.** A button that fires on every `<video>` tag on every page (ad banners,
   decorative loops, 1x1 tracking videos) clutters ordinary browsing and erodes trust in the
   tool. Filtering matters as much as detection.
4. Same inherited anti-goals as the original spec: fiddly configuration, feels slow, messy UI.

## Constraints

- Downloading from YouTube etc. is against those platforms' terms of service. This is
  explicitly accepted here as a personal, sideloaded tool for the user's own use (same
  framing already used for the extension's broad `cookies`/`host_permissions` grant) — not a
  distributed product, no store listing, no attempt to resist takedown/ToS enforcement. Worth
  a plain README note, same pattern as the extension's existing privacy note.
- `yt-dlp` is a third-party executable, not a Rust crate — this is a subprocess integration
  (spawn, parse stdout/stderr, handle non-zero exit), not a library call. The existing
  download engine (reqwest-based segmented HTTP) is not reused for these downloads; `yt-dlp`
  does its own fetching. The app's job is supervising the process and reporting progress into
  the existing queue UI, not performing the HTTP transfer itself.
- Must build on the existing extension (content-script injection is new, but pairing,
  handoff-to-app transport, and the app's local HTTP server already exist and should be
  reused/extended, not duplicated).

## Decisions made by the user (in brainstorming)

- **Tackle YouTube/social-platform downloads via `yt-dlp` before (or instead of) building a
  generic from-scratch video-sniffing pipeline.** Chosen because it's the user's actual
  immediate want, and because `yt-dlp` incidentally covers much of the generic "no download
  button" case for free.
- **Per-video hover button, not a single page-wide button or auto-detect-and-download.** The
  user wants to stay in control of exactly which video is targeted, informed directly by the
  IDM mismatch bug — hover-and-click on the specific video, not an ambiguous global action.
- **Resolution picker before download**, not an automatic "always grab best quality" flow —
  the user wants the choice IDM gave them, just without IDM's mismatch bug.
- **`yt-dlp` ships via auto-download + self-update**, not bundled statically into the
  installer — so a broken extractor (after a YouTube change) can be fixed by refreshing one
  binary, not by shipping a whole new app release.

## Decisions made by the builder (Claude), stated explicitly

- **Stale-reference fix:** the content script must re-resolve "what video is this" at the
  moment of click, not at the moment the button was first shown or injected. For YouTube
  specifically, the content script also needs to listen for YouTube's in-page navigation
  signal (it fires a custom event on client-side navigation) and re-evaluate/reposition or
  hide stale buttons when the page's active video changes, rather than trusting a long-lived
  cached reference. This is the direct, concrete fix for anti-goal #1 and should be treated
  as load-bearing, not a nice-to-have.
- **Video filtering heuristics** (to satisfy anti-goal #3 "button noise"): skip elements
  below roughly 200×150px, skip elements that are `display: none` or out of viewport, skip
  very short-duration loops (a few seconds) typical of decorative/ad content. Exact
  thresholds are an implementation-plan detail, tunable without changing the design.
- **New app-side endpoint**, separate from the existing `/downloads` (which expects a direct
  http(s) file URL). This new endpoint accepts a page URL (plus the same
  cookie/referer/user-agent capture pattern already used for ordinary downloads) and is
  responsible for invoking `yt-dlp` — first to probe available formats, then, once the user
  picks one, to perform the actual extraction+download. Exact route/payload shape is an
  implementation-plan detail.
- **Resolution picker UI lives in the desktop app's own window**, not as new extension-side
  popup UI. The app already has an established dialog/panel pattern (confirmation dialogs,
  settings panel); reusing it is less new surface area than building a second UI toolkit
  inside the extension. Clicking the hover button brings the app window forward with a format
  picker, the same way an ordinary captured download already surfaces into the app.
- **`yt-dlp` storage and update path:** stored in the app's own data directory (alongside the
  existing `pairing_token.txt`/`queue_state.json` pattern), downloaded on first real use, with
  a manual "Check for yt-dlp update" action in Settings as the v1 update mechanism. Automatic
  background update-checking is left as an implementation-plan nice-to-have, not required for
  v1 of this phase.
- **Progress reporting:** `yt-dlp` prints machine-parseable progress to stdout; the app parses
  that into the same queue-row UI already used for ordinary downloads, rather than inventing a
  parallel progress UI for "extracted" downloads.
- **`ffmpeg` is in scope, auto-fetched/self-updating the same way as `yt-dlp`.** Most YouTube
  resolutions above the lowest tier are DASH (separate video/audio streams) and need `ffmpeg`
  to mux into one file; without it, the resolution picker this phase exists to provide would
  silently degrade to low-res-only on the user's actual motivating site. Restricting to
  pre-merged "progressive" formats to avoid the extra binary was considered and rejected —
  it would defeat the point of offering a resolution choice at all.
- **yt-dlp-driven downloads are tracked by a separate, lightweight job manager, composited
  into the same queue UI for display — not folded into `QueueManager`'s existing
  `run`/`resolve`/staging logic.** That engine's resume/cleanup model is built entirely around
  reqwest range-requests and a `.partN` staging convention; a subprocess-driven job doesn't fit
  that shape, and forcing it in would mean duct-taping subprocess lifecycle onto byte-offset
  assumptions that don't apply. A second, simpler manager (track PID, parse progress, report
  status) whose rows render in the same list is less code and less risk than a deep refactor
  of `queue.rs`.
- **Pause/Resume are not offered for yt-dlp-kind rows in this phase; only Cancel and Retry
  are.** `yt-dlp`'s own resume convention doesn't line up with the existing engine's segment-
  resume model, and building true pause/resume for subprocess jobs is real extra scope nothing
  so far has asked for. Retry re-extracts from scratch.
- **The probe step and the download step share one cached extraction result, keyed to that
  button click — the download step never re-probes the live page from scratch.** When the user
  clicks the hover button, the app extracts video info once and caches it (format list +
  resolved video identity) against that request. The resolution picker's choices, and the
  eventual download, both come from that one cached result. This is deliberate: re-probing at
  download time would ask the page's *current* state for an answer to a question asked
  earlier, which is exactly the SPA-navigation mismatch this phase exists to prevent (anti-goal
  #1) — just moved from "stale button" to "stale probe," not actually fixed. If the cached
  result is too old to still be valid (e.g. a signed URL expired), the failure must surface as
  a clear "please try again" error, never a silent wrong-video substitution.
- **On app restart/crash, any yt-dlp-kind job that was mid-flight is marked failed, not
  resumed.** Unlike the reqwest engine's byte-level resume, there's no attempt to reuse
  `yt-dlp`'s own leftover partial/temp files after an unclean shutdown. The user retries, which
  re-extracts fresh — simpler, and avoids resuming against a source page whose state may have
  moved on, which again touches anti-goal #1.
- **Cross-origin iframe-embedded video (common on non-YouTube "no download button" sites) is a
  known, accepted gap for this phase**, not something discovered late. Content scripts only see
  the top frame's DOM by default; reaching into cross-origin iframes is real extra work that
  isn't justified until a concrete site the user actually hits needs it.

## What's left to the builder / implementation plan

- Exact content-script injection mechanism (shadow DOM for the button, hover/visibility
  detection, the YouTube-navigation-event listener and its generic-site fallback for non-SPA
  pages).
- Exact new HTTP route(s) and payload shape(s) on the app's local server for format-probe and
  extract+download, and how they reuse the existing pairing/auth (dmToken) model.
- `yt-dlp` process management: download source/URL for the Windows binary, verification
  (checksum) before first run, subprocess spawning, stdout progress-line parsing, error
  surfacing when extraction fails (unsupported site, video removed/private, network error).
- Resolution-picker dialog's concrete layout within the existing app window/UI patterns.
- Default/fallback behavior on sites `yt-dlp` doesn't recognize at all (clear error, not a
  silent failure — ties to anti-goal #2).
- Test strategy for the new pieces: content-script detection/filtering logic, the stale-
  reference fix specifically (this is the one bug this whole phase exists to avoid repeating),
  and the app's `yt-dlp` subprocess supervision (mocking the subprocess rather than hitting
  real YouTube in automated tests).
- README updates: ToS/personal-use note (parallel to the extension's existing privacy note),
  and how to manually refresh `yt-dlp` if a site breaks.

## Future phases (still explicitly out of scope)

1. **Generic from-scratch HLS/DASH/blob sniffing** for sites `yt-dlp` doesn't support —
   revisit only if real gaps show up in actual use after this phase ships.
2. **Playlist/batch extraction.**
3. **Torrent support** — unchanged, lowest priority.

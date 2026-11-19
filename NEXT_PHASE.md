# Next Phase

Running list of follow-up work identified during live testing, not yet done. Pulled out of chat so it doesn't get lost.

## Done

- [x] **Extract job concurrency limit.** `ExtractJobManager` had no cap on simultaneous `yt-dlp` probes/downloads, unlike `QueueManager`'s "Crops growing at once" setting. Unbounded parallel `yt-dlp` processes hammering YouTube from one IP was the likely cause of that session's throttling (formats missing stream URLs, downloads stuck at 0 B/s, "Unsupported URL" on otherwise-fine videos). Fixed by reusing `max_concurrent` as a `tokio::sync::Semaphore` in `ExtractJobManager` too (`src-tauri/src/extract/jobs.rs`). Committed as `38891ab`. Not yet live-retested end-to-end by the user since.

## Branding cleanup

- [x] **`README.md`** (repo root) — title, tagline, and project-structure tree updated to **LOADOUT Farm Log**. Git clone URL/repo directory name left as `download-manager` (that's the actual repo name on disk/GitHub, not app branding).
- [x] Other leftover "Download Manager" mentions fixed: `extension/README.md` (all user-visible extension-name references), `src/index.html`'s `<title>`. Left alone on purpose: `LICENSE` (already clean, no mentions), `docs/superpowers/specs/` and `docs/superpowers/plans/` (dated historical design docs, not meant to be rewritten), `docs/current-state-reference.md` (internal reference doc, not user-visible).

## Pause/Resume for YouTube (extract) downloads

Currently only Cancel (X) exists for extract jobs; Pause/Resume only exists for plain HTTP downloads (`QueueManager`). Discussed approach, not yet built:

- [ ] Add `ExtractStatus::Paused`.
- [ ] `pause(id)`: kill the `yt-dlp` process tree (like `cancel()`) but keep the partial file on disk; set status to `Paused` instead of `Canceled`.
- [ ] `resume(id)`: re-run the download the same way `retry()`/`choose_format()` does (same cached probe JSON, format selector, headers) — `yt-dlp`'s own default `--continue` behavior should pick up the partial file instead of restarting from 0, since we never pass `--no-continue`.
- [ ] New Tauri commands (`pause_extract_job`, `resume_extract_job`), wired into `main.rs`/`commands.rs`.
- [ ] Frontend: PAUSE/RESUME buttons in `actionsForExtract` (`app.js`), matching the existing download-row buttons.
- [ ] Known trade-off to keep in mind: unlike plain downloads, this isn't a precise in-process pause — it's kill-and-resume relying on `yt-dlp`'s own partial-file continue support. If paused for a long time, the cached signed stream URL can expire and resume will fail; user falls back to REPLANT (fresh re-probe) in that case. Worth a short note in the UI or docs so it doesn't look like a bug.

## Right-click context menu + double-click to open (FDM/IDM-style)

- [x] **Right-click a queue row** (download or extract/HARVEST) for a context menu: Open file / Open file location / Copy download link (Completed rows only for the first two), Pause/Resume/Replant/Cancel (status-dependent, mirrors the existing action buttons), Remove. Existing action buttons (LIMIT/PICK/REST/etc.) kept exactly as they were -- this is an additional, faster path, not a replacement.
- [x] **Double-click a Completed row** opens its file directly via the same `open_path_in_default_app` command; row shows an inline hint ("Double-click to open · right-click for more") on hover/selected, not a native `title=""` tooltip (that floated wherever the browser decided and could land on top of the context menu itself -- see the row-states design in the LOADOUT design canvas, `ContextMenu.dc.html`).
- [x] Backend: `ExtractJobInfo` gained `final_path` (set on completion, after the id-based-filename-to-friendly-name rename); `DownloadInfo` already had `dest_path`. New commands `open_path_in_default_app`/`reveal_path_in_file_manager` (`commands.rs`), both calling `tauri_plugin_opener`'s `OpenerExt` directly (no capability/permission entries needed, same pattern as `open_extension_folder`).
- [x] Frontend: `contextMenuItemsFor`/`openContextMenu`/`closeContextMenu` + per-row `contextmenu`/`dblclick` listeners in `app.js`; menu reuses the existing `.popover`/`.pick` styling (`.popover.ctxmenu` override for fixed positioning, new `.pick.danger`/`.pickdiv` rules) in `styles.css`. Row also gets `.row:hover`/`.row.selected` background tints and a `.hint` line (opacity-faded, never floats).
- [x] Live-tested by the user in the real running app -- context menu, double-click, and hover/selected states all confirmed working.

## Multi-Chrome-profile simultaneous pairing

- [x] **Several Chrome/Edge profiles can now be paired at once.** Discussed approach (3 options), user picked "pairing mode gate" + a visible paired-profiles list. `PairingState` (`server/mod.rs`) rewritten from a single token+bool to a `Vec<PairedProfile>` (`id`, `token`, `label`, `paired_at`), persisted to `paired_profiles.json` (migrates an older install's single `pairing_token.txt`/`.paired` the first time it finds no new-format file).
- [x] **First-ever pairing stays zero-click** (empty list = anyone can pair, same atomicity guarantee as the old `compare_exchange`, now via one `Mutex` critical section). Every pairing after that needs **Settings -> "Allow new pairing"** clicked first, which opens a 2-minute window (`PAIRING_MODE_DURATION`); `/pair` outside that window returns `403` with an explanatory JSON body the extension's options page shows verbatim.
- [x] New commands: `list_paired_profiles`, `allow_new_pairing`, `pairing_mode_remaining_seconds` (resyncs the countdown if Settings is reopened mid-countdown), `forget_paired_profile`, `rename_paired_profile`. `/unpair` now removes one profile by token instead of flipping a global flag.
- [x] Settings panel gained an "ALLOW NEW PAIRING" button with a live countdown, and a "Paired browsers" list (editable label + paired-date + per-row FORGET), styled to match the rest of the panel.
- [x] `extension/options.js`'s `pair()` now surfaces the app's explanatory 403 message; `extension/README.md`'s "Reset pairing" section rewritten for the new per-profile model.
- [x] Full backend test suite (27 tests in `handoff_server.rs`, several new: `allow_new_pairing_opens_a_second_pairing_window`, `pairing_mode_expires_after_its_duration`, `forget_by_id_removes_only_that_profile`, `rename_updates_label_without_touching_token_validity`, migration tests) passing.
- [x] Live-tested by the user in the real running app -- confirmed working.

## Desktop text-selection

- [x] **The whole UI was selectable like a web page** (dragging across the empty-state message highlighted it blue, etc.) -- looked wrong for a desktop app. Fixed with a global `user-select: none` on `html`/`body` in `styles.css`, re-enabled only for `input`/`textarea` (where normal text editing/selection is still expected).

## Other loose ends from this session

- [ ] **No timeout for a hung `yt-dlp` process.** Observed today: a download stuck at "WORKING — 0 B — 0 B/s" for 5+ minutes with nothing in the UI to distinguish "slow" from "actually hung." No code currently times out a `yt-dlp` child; only a manual Cancel recovers. Consider a watchdog (e.g. fail the job if no progress line arrives within N minutes).
- [ ] **LIMIT button shows on WITHERED (Failed) rows** — confirmed intentional (pre-configures the speed limit REPLANT will use), but was flagged as confusing without context. Never decided whether to add a hint/tooltip explaining it. Low priority, pure UX polish.
- [ ] **Diagnostic `eprintln!`s added to `extract/jobs.rs`** (probe/download stderr, raw stdout line counts) during this session's "Unsupported URL" investigation are dev-console-only right now. Worth deciding whether any of that should surface in the app's own UI (e.g. an expandable "details" on a Failed extract row) instead of only being visible when running `cargo tauri dev` with a terminal open.

## From the original brainstorms (never built, still on the table)

Pulled from `BRAINSTORM.md` and the "Future phases" sections of `docs/superpowers/specs/2026-11-12-download-manager-design.md` and `docs/superpowers/specs/2026-11-14-video-download-design.md`. Everything else from those brainstorms (general download manager, browser extension handoff, YouTube/social-platform download via `yt-dlp`) is already built.

- [ ] **Playlist/batch extraction** — download a whole YouTube playlist/channel in one go, instead of one video at a time.
- [ ] **Generic HLS/DASH/blob sniffing** for sites `yt-dlp` itself doesn't support. Explicitly deferred in the original spec: "revisit only if real gaps show up in actual use" — `yt-dlp` already covers a huge number of sites, so build this only once a specific site is confirmed to fail.
- [ ] **Skip shortlink/landing-page-host download buttons** (Pixeldrain/Google Drive-style pages with their own "Download" button) — auto-resolve straight into the queue instead of the user clicking through. Explicitly parked in `BRAINSTORM.md`: don't build speculatively, only once there's real friction at a specific, frequently-used site.
- [ ] **Torrent support** — lowest priority across every design doc so far; FDM already covers this need today.

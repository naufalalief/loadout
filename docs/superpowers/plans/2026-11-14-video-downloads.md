# Video & Social-Platform Downloads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user download YouTube (and any other `yt-dlp`-supported site's) video from a small hover-over button the extension injects over the video, picking a resolution, without ever repeating IDM's "downloaded the wrong video" bug.

**Architecture:** A new Rust `extract` module (`BinaryManager` + `ExtractJobManager`) auto-fetches and drives `yt-dlp`/`ffmpeg` as subprocesses, tracked in its own lightweight job list — separate from `QueueManager`, which stays exactly as-is — but rendered in the same queue UI. The extension's content script detects hovered `<video>` elements and resolves, at the moment of click, the specific URL that video belongs to; its background script forwards that (plus captured cookies) to one new local-server route, `POST /extract`, which starts a probe. The app's own window surfaces the resulting format choice; picking one, canceling, and retrying are plain Tauri commands, never round-tripping back through the browser.

**Tech Stack:** Rust (`tokio::process::Command` for subprocess control, `axum` for the one new route, `reqwest` for fetching the `yt-dlp`/`ffmpeg` binaries themselves, new `zip`/`sha2` crates), vanilla JS (new `extension/content.js`, extended `background.js`, extended `src/app.js`).

**Spec:** `docs/superpowers/specs/2026-11-14-video-download-design.md` (and the original `docs/superpowers/specs/2026-11-12-download-manager-design.md`)

**Depends on:** the core-app plan (`QueueManager`, `SettingsStore`, app data dir conventions) and the browser-extension plan (`captureHeaders`, `sendToApp`-style patterns, pairing/`dmToken`, the local handoff server) — both already shipped. This plan only adds to them; it does not change `download/queue.rs`'s existing behavior.

## Global Constraints

- `yt-dlp` and `ffmpeg` are auto-fetched on first use and stored at `settings::app_data_dir().join("bin")` — never bundled in the installer (design doc decision).
- Extract jobs are tracked by a **separate, in-memory-only** manager (`ExtractJobManager`), never folded into `QueueManager`'s state or its persisted `queue_state.json`. There is no state file for extract jobs at all — an app restart simply forgets any in-flight one (design doc decision #5, resolved even more simply than "mark Failed": nothing persists to mark).
- Extract jobs offer **Cancel and Retry only** — no Pause/Resume (design doc decision).
- The probe step (`POST /extract`) and the later format-choice step share one cached extraction result keyed to the job id; choosing a format **never** re-probes the source page from scratch (design doc decision #4 — this is the direct fix for the IDM wrong-video bug and is load-bearing, not a style choice).
- Cross-origin iframe-embedded video is an accepted, out-of-scope gap for this phase (design doc).
- The new `/extract` route reuses the existing `X-Dm-Token` auth and loopback-`Host` middleware exactly as `/downloads` does — no new auth mechanism.
- Downloading from YouTube/etc. is against those platforms' ToS; accepted here as a personal, sideloaded tool (design doc constraint) — needs a plain README note, not a technical control.

## Review Focus

- A user clicks the hover button, then — before picking a resolution — navigates to a different video on an SPA site (YouTube related-video click). The cached extraction and the eventual download must still refer to the **originally probed** video, never the page's current one. (Task 2, Task 7)
- `yt-dlp` is pointed at a URL/site it doesn't recognize at all. The job must end `Failed` with a readable error, never stuck `Probing` forever and never a panic. (Task 2)
- Two hover-button clicks land back-to-back (two different videos, or the same one twice) before either probe resolves. Both must get independent job entries and independent cached extractions — never one overwriting the other's cached data. (Task 2)
- `yt-dlp`/`ffmpeg` haven't been downloaded yet (fresh install, first use of this feature) when a probe or a chosen download starts. It must transparently fetch them first, not hang or crash — and a user starting two such jobs at once must not trigger two redundant/overlapping downloads of the same binary. (Task 1, Task 2)
- The app is killed while an extract job is mid-download. On the next launch, nothing about startup must trip over `yt-dlp`'s own leftover temp/partial files in `download_dir` (`QueueManager`'s crash-recovery logic only resets its own entries and knows nothing about these files). (Task 1, Task 7)

---

## Task 1: `BinaryManager` — fetch, verify, and update `yt-dlp`/`ffmpeg`

**Files:**
- Create: `src-tauri/src/extract/mod.rs`
- Create: `src-tauri/src/extract/binaries.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod extract;`)
- Modify: `src-tauri/Cargo.toml` (add `zip = "2"`, `sha2 = "0.10"`)
- Test: `src-tauri/src/extract/binaries.rs` (`#[cfg(test)]` module)

**Interfaces:**
- Produces:
  ```rust
  pub struct BinaryManager { /* dir: PathBuf, client: reqwest::Client, endpoints: Endpoints */ }

  #[derive(Debug, Clone, PartialEq, Eq)]
  pub enum BinaryError { Network(String), Io(String), ChecksumMismatch, Unexpected(String) }
  // impl std::fmt::Display + std::error::Error, same pattern as download::types::DownloadError

  impl BinaryManager {
      pub fn new(dir: PathBuf) -> Self;
      pub fn ytdlp_path(&self) -> PathBuf;   // dir.join("yt-dlp.exe")
      pub fn ffmpeg_path(&self) -> PathBuf;  // dir.join("ffmpeg.exe")
      pub async fn ensure_ytdlp(&self) -> Result<PathBuf, BinaryError>;
      pub async fn ensure_ffmpeg(&self) -> Result<PathBuf, BinaryError>;
      pub async fn update_ytdlp(&self) -> Result<PathBuf, BinaryError>;

      #[doc(hidden)]
      pub fn new_with_endpoints(dir: PathBuf, ytdlp_api_base: String, ffmpeg_zip_url: String) -> Self;
  }
  ```

- `ensure_ytdlp`/`ensure_ffmpeg`: if the respective path already exists on disk, return it immediately without any network call. Otherwise fetch it (see below) and return the freshly-written path. Two overlapping callers (Review Focus item 4) must not both download: guard each binary's fetch with its own `tokio::sync::Mutex<()>` held for the whole ensure/fetch, so the second caller simply waits and then observes the first's completed file.
- `update_ytdlp`: unconditionally re-fetches and overwrites `yt-dlp.exe`, ignoring whether it already exists.
- **yt-dlp source:** `GET {ytdlp_api_base}/repos/yt-dlp/yt-dlp/releases/latest` (default `ytdlp_api_base = "https://api.github.com"`) returns JSON with an `assets` array; find the asset named exactly `yt-dlp.exe` for the binary and `SHA2-256SUMS` for its checksum file (both have a `browser_download_url` field). Download both, extract the hex digest for `yt-dlp.exe` out of the checksums file's lines (format: `<hex>  yt-dlp.exe`), hash the downloaded binary with `sha2::Sha256`, and return `BinaryError::ChecksumMismatch` on any mismatch — the mismatched file must not be left at `ytdlp_path()` (write to a temp path first, rename into place only after the check passes).
- **ffmpeg source:** a single fixed URL, `{ffmpeg_zip_url}` (default `"https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"`). Download the zip, open it with the `zip` crate, find the entry whose path ends in `/bin/ffmpeg.exe`, extract just that entry to `ffmpeg_path()`. No checksum verification for ffmpeg (accepted for v1 — this build has no published per-release checksum matching this stable "latest" alias; flag this as the explicit tradeoff, not an oversight).
- GitHub's API requires a `User-Agent` header on every request (returns 403 without one) — set one (e.g. `"download-manager"`) on every request `BinaryManager` makes.

- [ ] **Step 1: Write failing tests using `wiremock`** (already a dev-dependency), covering: `ensure_ytdlp` downloads and verifies against a stubbed GitHub API + matching checksum file (success case) and returns `ChecksumMismatch` when the stubbed checksum doesn't match the stubbed binary body; `ensure_ytdlp` is a no-op (no HTTP calls at all — assert via wiremock's request-count assertions) when the file already exists; `ensure_ffmpeg` downloads a small real zip fixture (construct one in the test with the `zip` crate, containing a nested `bin/ffmpeg.exe` entry) and extracts the right file to the right path; two concurrent `ensure_ytdlp` calls against a slow stub only trigger one download (assert the mock server saw exactly one request for the binary asset).

- [ ] **Step 2: Run tests, confirm they fail** (module doesn't exist yet).

- [ ] **Step 3: Implement `BinaryManager` per the Interfaces block.**

- [ ] **Step 4: Run tests, confirm they pass.**

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/extract/mod.rs src-tauri/src/extract/binaries.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: add BinaryManager to fetch/verify/update yt-dlp and ffmpeg"
```

---

## Task 2: `ExtractJobManager` — probe, format choice, cancel, retry

**Files:**
- Create: `src-tauri/src/extract/jobs.rs`
- Modify: `src-tauri/src/extract/mod.rs` (re-export)
- Test: `src-tauri/src/extract/jobs.rs` (`#[cfg(test)]` module)

**Interfaces:**
- Consumes: `BinaryManager` (Task 1) for `ensure_ytdlp`/`ensure_ffmpeg` paths before every subprocess spawn.
- Produces:
  ```rust
  #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
  pub enum ExtractStatus { Probing, AwaitingFormatChoice, Downloading, Completed, Failed, Canceled }

  #[derive(Debug, Clone, Serialize)]
  pub struct ExtractFormatOption {
      pub label: String,            // "1080p", "720p", "480p", "360p"
      pub format_selector: String,  // yt-dlp -f value, e.g. "bestvideo[height<=1080]+bestaudio/best[height<=1080]"
  }

  #[derive(Debug, Clone, Serialize)]
  pub struct ExtractJobInfo {
      pub id: String,
      pub source_url: String,
      pub title: String,            // "" until probing finishes
      pub status: ExtractStatus,
      pub formats: Vec<ExtractFormatOption>, // empty until AwaitingFormatChoice
      pub downloaded_bytes: u64,
      pub total_bytes: Option<u64>,
      pub error: Option<String>,
  }

  pub struct ExtractJobManager { /* ... */ }

  impl ExtractJobManager {
      pub fn new(
          download_dir: PathBuf,
          binaries: Arc<BinaryManager>,
          on_new_job: Arc<dyn Fn() + Send + Sync>,
      ) -> Self;

      pub fn list(&self) -> Vec<ExtractJobInfo>;

      /// Starts probing `source_url` in the background; returns the new
      /// job's id immediately (status `Probing`). `headers` (Cookie/
      /// Referer/User-Agent) are forwarded to yt-dlp for both this probe
      /// and, later, the chosen download, via `--add-header`/`--referer`/
      /// `--user-agent`.
      pub fn probe(&self, source_url: String, headers: HashMap<String, String>) -> String;

      /// Starts the download for `id` using `format_label` (must match one
      /// of that job's cached `ExtractFormatOption::label`s). Fails without
      /// starting anything if `id` isn't `AwaitingFormatChoice`, or if
      /// `format_label` doesn't match a cached option (stale/expired cache
      /// surfaces as an error here, never a silent re-probe).
      pub fn choose_format(&self, id: &str, format_label: &str) -> Result<(), String>;

      /// Kills the job's live subprocess (if any) and marks it `Canceled`.
      /// A no-op if `id` is already in a terminal status.
      pub fn cancel(&self, id: &str);

      /// Re-probes a `Failed` job from scratch, using its originally
      /// captured `source_url`/headers (retained on the entry specifically
      /// so Retry can do this). A no-op (returns an error) for any other
      /// status.
      pub fn retry(&self, id: &str) -> Result<(), String>;

      #[doc(hidden)]
      pub fn new_with_binaries(
          download_dir: PathBuf,
          ytdlp_path: PathBuf,
          ffmpeg_path: PathBuf,
          on_new_job: Arc<dyn Fn() + Send + Sync>,
      ) -> Self;
  }
  ```
- `on_new_job` is called once per `probe()` call, synchronously, right after the new `Probing` entry is inserted — this is how the app's main window gets brought forward (Task 4 wires the real callback; tests pass `Arc::new(|| {})`).
- Cached per-job extraction data (source URL + headers, retained until the job reaches `Completed` or `Canceled` so `retry` keeps working from `Failed`) lives in a side map the same way `QueueManager::headers` does — not on `ExtractJobInfo` itself, so it's never accidentally serialized if this type gains `Deserialize`/persistence later.
- **Probe subprocess:** `<yt-dlp> --no-playlist --dump-single-json --add-header "Cookie: <...>" --referer <...> --user-agent <...> <source_url>` (omit a header flag entirely when its captured value is empty, same convention as the extension's M4 fix). Parse stdout as JSON; pull `title` (fallback to `source_url` if absent/empty) and build `formats` by taking every entry in the JSON's `formats` array where `vcodec` isn't `"none"`, deduplicating by `height` (keep the first seen per height), sorting descending, and mapping each to `ExtractFormatOption { label: format!("{height}p"), format_selector: format!("bestvideo[height<={height}]+bestaudio/best[height<={height}]") }`. A JSON parse failure, a non-zero exit, or an empty resulting `formats` list all end the job `Failed` with yt-dlp's own first non-empty stderr line as `error` (fallback: `"Unsupported or unrecognized URL"`).
- **Download subprocess:** `<yt-dlp> --no-playlist -f "<format_selector>" --merge-output-format mp4 --ffmpeg-location <ffmpeg_dir> --newline --print "after_move:filepath" -o "<download_dir>/%(title)s.%(ext)s" --add-header ... --referer ... --user-agent ... <source_url>`. `--newline` forces one progress line per update (instead of in-place carriage returns) so stdout can be read line-by-line; parse each `[download]  NN.N% of ~SIZE` line for `downloaded_bytes`/`total_bytes` (percent × a size parsed from the same line is sufficient — exact regex is the implementer's call). The line printed by `--print "after_move:filepath"` (the last line of output on success) is the completed file's absolute path; a job that exits 0 without that line, or exits non-zero, ends `Failed` the same way probing failures do.
- Every subprocess is spawned via `tokio::process::Command`, with its `Child` handle kept (keyed by job id) only while it's alive, so `cancel()` can call `.kill()` on it; removed once the task observes the process has exited.

- [ ] **Step 1: Write failing tests using a stub "yt-dlp" script** (a small test-fixture `.cmd`/batch file, or a tiny Rust-compiled test helper binary, read JSON/exit-code behavior driven by its arguments or an env var so different tests can make it behave differently) **wired in via `ExtractJobManager::new_with_binaries`**, covering:
  - `probe()` on a stub that prints valid `--dump-single-json` output ends with status `AwaitingFormatChoice`, the right `title`, and formats deduplicated/sorted as specified.
  - `probe()` on a stub that exits non-zero with stderr `"ERROR: Unsupported URL"` ends `Failed` with that message.
  - Two `probe()` calls in quick succession produce two distinct job ids, each independently reaching its own correct terminal state (Review Focus item 3).
  - `choose_format()` against a job whose cached extraction still says `source_url = A`, called *after* a second, unrelated `probe()` for `source_url = B` has also run, still invokes the stub against `A` — proving the cache, not any shared/global "current" URL, drives the download (Review Focus item 1, the core anti-goal check, at the unit level — Task 7 adds the real-browser version of this check).
  - `choose_format()` with a `format_label` that doesn't match any cached option returns `Err` and spawns nothing (assert no new subprocess/side effect).
  - `cancel()` on a `Downloading` job kills its process and the job ends `Canceled` (not `Failed`).
  - `retry()` on a `Failed` job re-probes using the same retained `source_url`/headers; `retry()` on any other status returns `Err`.

- [ ] **Step 2: Run tests, confirm they fail.**

- [ ] **Step 3: Implement `ExtractJobManager` per the Interfaces block.**

- [ ] **Step 4: Run tests, confirm they pass.**

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/extract/jobs.rs src-tauri/src/extract/mod.rs
git commit -m "feat: add ExtractJobManager for yt-dlp probe/download orchestration"
```

---

## Task 3: Local server `POST /extract` route

**Files:**
- Modify: `src-tauri/src/server/mod.rs`
- Modify: `src-tauri/tests/handoff_server.rs` (existing tests call `router_for_port`/`serve` — update their call sites for the new parameter; add new tests)

**Interfaces:**
- Consumes: `ExtractJobManager::probe` (Task 2).
- Produces/modifies:
  ```rust
  // mod.rs — signatures gain one parameter each:
  pub fn router(queue: Arc<QueueManager>, pairing: Arc<PairingState>, extract_jobs: Arc<ExtractJobManager>) -> Router;
  pub fn router_for_port(queue: Arc<QueueManager>, pairing: Arc<PairingState>, extract_jobs: Arc<ExtractJobManager>, port: u16) -> Router;
  pub async fn serve(queue: Arc<QueueManager>, pairing: Arc<PairingState>, extract_jobs: Arc<ExtractJobManager>);
  ```
  ```rust
  #[derive(Deserialize)]
  struct ExtractRequestBody {
      url: String,
      #[serde(default)]
      headers: HashMap<String, String>,
  }

  #[derive(Serialize)]
  struct ExtractResponse { id: String }

  async fn extract(State(state): State<AppState>, headers: HeaderMap, Json(body): Json<ExtractRequestBody>) -> impl IntoResponse;
  ```
- `extract` applies the exact same two checks `add_download` already does, in the same order: `X-Dm-Token` match (else `401`), then `url_scheme_is_http_or_https(&body.url)` (else `400`, reusing that existing function unchanged) — only then calls `state.extract_jobs.probe(body.url, body.headers)` and returns `201` with `ExtractResponse`.
- `AppState` gains one field, `extract_jobs: Arc<ExtractJobManager>`; route added: `.route("/extract", post(extract))`, inside the same `require_loopback_host` middleware layer as every other route (no change needed there).

- [ ] **Step 1: Write failing tests in `handoff_server.rs`** (same style as the existing `downloads_rejects_non_http_url_without_touching_queue` test — spin up `router_for_port` with a real `ExtractJobManager` built via `ExtractJobManager::new_with_binaries`, pointed at Task 2's stub yt-dlp fixture), covering: `POST /extract` without a valid token → `401`, nothing probed; `POST /extract` with a `blob:`/non-http(s) `url` → `400`, nothing probed; `POST /extract` with a valid token and an `http(s)` URL → `201` with a `{id}` body, and that id shows up via `ExtractJobManager::list()`.

- [ ] **Step 2: Run tests, confirm they fail** (update existing call sites first just enough to compile — this is expected to also require fixing the pre-existing tests' calls to `router_for_port`/`serve`).

- [ ] **Step 3: Implement `extract` and the signature changes per the Interfaces block.**

- [ ] **Step 4: Run the full `handoff_server.rs` suite, confirm everything (old and new) passes.**

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/server/mod.rs src-tauri/tests/handoff_server.rs
git commit -m "feat(server): add POST /extract route for yt-dlp handoff"
```

---

## Task 4: Tauri commands + app wiring

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

**Interfaces:**
- Consumes: `BinaryManager` (Task 1), `ExtractJobManager` (Task 2), the updated `server::serve`/`router` (Task 3).
- Produces, in `commands.rs`:
  ```rust
  #[tauri::command]
  pub fn list_extract_jobs(jobs: State<Arc<ExtractJobManager>>) -> Vec<ExtractJobInfo>;

  #[tauri::command]
  pub fn choose_extract_format(id: String, format_label: String, jobs: State<Arc<ExtractJobManager>>) -> Result<(), String>;

  #[tauri::command]
  pub fn cancel_extract_job(id: String, jobs: State<Arc<ExtractJobManager>>) -> Result<(), String>;

  #[tauri::command]
  pub fn retry_extract_job(id: String, jobs: State<Arc<ExtractJobManager>>) -> Result<(), String>;

  #[tauri::command]
  pub async fn check_ytdlp_update(binaries: State<Arc<BinaryManager>>) -> Result<String, String>;
  // Ok("yt-dlp updated to the latest version.") on success, Err(e.to_string()) on BinaryError.
  ```
- `main.rs` changes:
  - Construct `let binaries = Arc::new(BinaryManager::new(settings::app_data_dir().join("bin")));` alongside the existing `queue_manager`/`settings_store` construction.
  - `ExtractJobManager::new` needs `on_new_job`, but no `AppHandle` exists yet at that point in `main()` — construct it with a placeholder opener (e.g. `Arc::new(|| {})`) and add one new method to `ExtractJobManager` not listed in Task 2 (small addition there, or here — implementer's call which task's diff it lands in as long as it's done): `pub fn set_window_opener(&self, opener: Arc<dyn Fn() + Send + Sync>)`, replacing the placeholder. Call it inside `.setup()`, right next to the existing `tray::build_tray`/`show_main_window` calls, with a closure that clones `app.handle()` and calls the existing `show_main_window` helper. (This mirrors the same narrow, accepted startup-ordering window the core-app plan's N1 finding already documented for a different subsystem — not a new regression to chase down.)
  - `.manage(Arc::clone(&binaries))`, `.manage(Arc::clone(&extract_jobs))`.
  - Update the `tauri::async_runtime::spawn(server::serve(...))` call to pass `Arc::clone(&extract_jobs)` as the new third argument.
  - Add the five new commands to the `tauri::generate_handler![...]` list.

- [ ] **Step 1: Implement the commands and the `main.rs` wiring per the Interfaces block.**

- [ ] **Step 2: Build and run the existing test suite** (`CARGO_BUILD_JOBS=1 cargo test -j 1`) to confirm nothing broke from the `server::serve`/`router` signature change.

Run: `CARGO_BUILD_JOBS=1 cargo test -j 1`
Expected: all existing tests still pass; no new tests in this task (pure wiring, exercised by Task 3's and Task 5/6's own verification).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat: wire BinaryManager/ExtractJobManager into Tauri commands and app startup"
```

---

## Task 5: Frontend — extract-job rows and format picker

**Files:**
- Modify: `src/app.js`
- Modify: `src/index.html` (Settings panel: add an update-check button/status line)
- Modify: `src/styles.css` (if the extract-row format picker needs layout not already covered by `.download-row`)

**Interfaces:**
- Consumes: `list_extract_jobs`, `choose_extract_format`, `cancel_extract_job`, `retry_extract_job`, `check_ytdlp_update` (Task 4).
- Produces, in `app.js`:
  - `refreshList()` is extended to also `invoke("list_extract_jobs")`, tag each result `job.kind = "extract"` (and each plain download `download.kind = "http"`) client-side, and merge both arrays before the existing render loop — reusing `rowsById` with extract-job rows keyed by a prefixed id (`` `x:${job.id}` ``) so they can never collide with an HTTP download's uuid.
  - `createRow`/`updateRow`/`actionsFor` branch on `.kind`:
    - `actionsFor` for `kind === "extract"`: `Cancel` (statuses `Probing`/`AwaitingFormatChoice`/`Downloading`) and `Retry` (`Failed`) only — never Pause/Resume, and the per-row speed-limit input (`.download-limit`) stays hidden for every extract row regardless of status.
    - `updateRow` for `kind === "extract"` shows `job.title || job.source_url` as the title; for `status === "AwaitingFormatChoice"`, renders a `<select>` of `job.formats` (by `label`) plus a `"Download"` button (wired to `choose_extract_format(job.id, selectedLabel)`) in place of the progress bar; for `Probing`/`Downloading`, shows the same indeterminate/percent progress bar `updateRow` already knows how to render (percent from `downloaded_bytes`/`total_bytes` when `total_bytes` is known, indeterminate otherwise); for `Completed`/`Failed`/`Canceled`, same meta/error text treatment as an HTTP download row.
  - A new "Check for yt-dlp update" button in the Settings panel (`src/index.html`), wired to `invoke("check_ytdlp_update")`, showing its resolved message (success text or the error) in a small status line next to it — not a full page reload or panel close.

- [ ] **Step 1: Implement the merge, the per-kind branching, and the Settings button per the Interfaces block.**

- [ ] **Step 2: Verify manually.** With the app running: trigger an extract job (can be done ahead of Task 6 by `POST`ing to `/extract` directly, e.g. via `curl` or a REST client, with a valid `X-Dm-Token`) against a real YouTube URL. Expected: a new row appears titled with the video's real title once probing finishes, showing a resolution dropdown and a "Download" button; picking a resolution and clicking it switches the row to a progress bar that advances and ends `Completed`; a `Cancel` click on a `Downloading` row stops it cleanly; a deliberately broken/non-video URL ends the row `Failed` with a visible error and a working `Retry` button. Click "Check for yt-dlp update" in Settings and confirm it shows a success message.

- [ ] **Step 3: Commit**

```bash
git add src/app.js src/index.html src/styles.css
git commit -m "feat(ui): render extract jobs in the queue list with a resolution picker"
```

---

## Task 6: Extension content script — hover button + SPA-safe target resolution

**Files:**
- Create: `extension/content.js`
- Modify: `extension/manifest.json` (add `content_scripts`)
- Modify: `extension/background.js` (add the `extractVideo` message handler + probe POST)

**Interfaces:**
- Consumes: `captureHeaders` (already in `background.js`, from the browser-extension plan's Task 3 — reused unchanged, called with the resolved target URL instead of a download URL).
- Produces:
  - `manifest.json` gains:
    ```json
    "content_scripts": [
      { "matches": ["<all_urls>"], "js": ["content.js"], "run_at": "document_idle" }
    ]
    ```
  - `content.js`:
    ```js
    function findCandidateVideos(): HTMLVideoElement[]
    // All <video> elements that are: at least ~200x150px (getBoundingClientRect),
    // not display:none and not visibility:hidden, and (once readyState is high
    // enough to know) not shorter than ~3 seconds -- a video whose duration is
    // still NaN/unknown is kept, not filtered (per the design doc's filters).

    function resolveTargetUrl(videoEl: HTMLVideoElement): string
    // The href of the nearest ancestor <a href> of videoEl if one exists
    // (resolved to an absolute URL), else window.location.href -- evaluated
    // fresh every time this is called, never cached across calls. This is
    // what a button's click handler calls at the moment of the click, not
    // at the moment the button was shown (the direct fix for the stale-
    // reference bug this whole phase exists to avoid).
    ```
    plus: a shadow-DOM overlay button shown on `mouseenter` of each candidate video (positioned via `getBoundingClientRect()`) and hidden on `mouseleave`; a rescan triggered by `document.addEventListener('yt-navigate-finish', rescan)` (YouTube's own SPA-navigation signal) and, generically, by polling `location.href` for changes roughly once a second and calling `rescan()` when it changes — `rescan()` just re-runs `findCandidateVideos()` and reconciles which videos currently have a live overlay attached, same spirit as `app.js`'s `refreshList()` reconciliation.
    - The button's click handler calls `chrome.runtime.sendMessage({ type: "extractVideo", pageUrl: resolveTargetUrl(videoEl) })` and gives brief visual feedback (e.g. temporarily disables/relabels itself) — exact feedback styling is the implementer's call.
  - `background.js` gains:
    ```js
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => { /* ... */ });
    // On { type: "extractVideo", pageUrl }: calls captureHeaders(pageUrl, "")
    // (empty referrer -- there is no meaningful "download referrer" concept
    // for a page-URL extraction), then sendExtractProbe(pageUrl, headers).
    // Returns true (keeps the message channel open for the async response)
    // and eventually calls sendResponse with {ok: boolean, error?: string}
    // so the content script could surface a failure if it chooses to.

    async function sendExtractProbe(pageUrl, headers): Promise<{ok: boolean, error?: string}>
    // Same dmToken-first-check, AbortController-timeout, fail-safe pattern
    // as sendToApp (Task 4 of the browser-extension plan) -- POSTs to
    // http://127.0.0.1:57431/extract instead of /downloads, body
    // {url: pageUrl, headers: {Cookie, Referer, "User-Agent"}}. {ok: false}
    // on any missing token, non-201 response, timeout, or network error,
    // with a short `error` string for the UI to show if it wants to.
    ```

- [ ] **Step 1: Implement `content.js` and the `background.js` additions per the Interfaces block.**

- [ ] **Step 2: Verify manually.** Reload the unpacked extension. On a YouTube watch page, hover the main player: the overlay button appears; click it, confirm (via the app's queue, Task 5) a new extract job appears for that exact video. While still on the watch page, click a related video (SPA navigation, no full reload) and then hover and click the button again: confirm the new job's `source_url`/title corresponds to the *second* video, not the first (a first, cheap pass at Review Focus item 1 — Task 7 does the full end-to-end version). On a non-YouTube page with an ordinary small decorative/ad `<video>`, confirm no button appears at all.

- [ ] **Step 3: Commit**

```bash
git add extension/content.js extension/manifest.json extension/background.js
git commit -m "feat(extension): add hover-to-download button with SPA-safe target resolution"
```

---

## Task 7: Docs, unsupported-site behavior, and the end-to-end stale-reference check

**Files:**
- Modify: `extension/README.md`

**Interfaces:**
- Produces: new README sections — a short ToS/personal-use note (parallel to the existing privacy-permissions note), and a "Refreshing yt-dlp" section pointing at the Settings "Check for yt-dlp update" button (Task 5) as the way to recover when a site extraction starts failing after a `yt-dlp` has gone stale.

- [ ] **Step 1: Write the README additions.**

- [ ] **Step 2: Verify manually — the full stale-reference regression check (Review Focus item 1).** On YouTube: hover and click the download button on video A, but do **not** pick a resolution yet. While the job sits `AwaitingFormatChoice`, navigate (via a related-video click, no reload) to video B. Return to the app window and pick a resolution for the still-open job. Confirm the file that downloads is video A's content, not video B's — read its title/filename against what the row showed at probe time.

- [ ] **Step 3: Verify manually — the remaining Review Focus items.** A clearly unsupported URL (e.g. a plain search-engine homepage) ends its job `Failed` with a readable error, not stuck `Probing`. Click the hover button on two different videos within a couple of seconds of each other; confirm two independent rows reach two independently-correct results. On a fresh profile/app-data directory (or after manually deleting the `bin` folder), trigger an extract job and confirm it transparently fetches `yt-dlp`/`ffmpeg` first rather than failing. Kill the app (Task manager, not a clean exit) while a job is `Downloading`, relaunch it, and confirm the app starts normally with no stuck row and no error referencing leftover `yt-dlp` temp files.

- [ ] **Step 4: Commit**

```bash
git add extension/README.md
git commit -m "docs(extension): add ToS note and yt-dlp refresh instructions"
```

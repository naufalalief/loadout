# LOADOUT Extension + Icon Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish round 2 of the LOADOUT visual redesign — restyle the browser extension's two
surfaces (hover-to-download button, options page), add a new "Browser Companion Setup Guide"
popup to the main app with real OS-integration commands, and finish the per-file-type icon set
the main window only partially wired up in round 1.

**Architecture:** Four mostly-independent pieces touching almost entirely disjoint files. The
extension (`extension/`) and the main app (`src/` + `src-tauri/`) are separate packages with no
shared module boundary — each needs its own copy of anything it needs (fonts). The one new
backend capability (`tauri-plugin-opener`, for the setup guide's two action buttons) is added in
the same task that needs it, since nothing else in this round uses it.

**Tech Stack:** Vanilla HTML/CSS/JS (extension and main app, both unchanged from round 1), Tauri
2.12 Rust backend, `tauri-plugin-opener` (new), `tauri-plugin-clipboard-manager` (new, fallback
path).

**Spec:** `docs/superpowers/specs/2026-11-17-loadout-extension-and-icons-design.md`

## Global Constraints

- The extension and the main app ship as two completely separate packages (a Chrome
  "Load unpacked" folder vs. an NSIS-installed desktop app) — never share a filesystem path
  between them. The extension gets its own `extension/fonts/` copy of both font files.
- `extension/content.js`'s overlay already lives in a closed shadow DOM — keep that structure,
  change only the injected CSS/markup/text.
- `extension/options.js`'s existing functions (`checkAppRunning`, `pair`, `forgetPairing`,
  `refreshPairButton`) and every element id it currently reads keep their exact names/ids —
  restyle what they drive, not how they work.
- The Browser Companion Setup Guide is a popup in the **main app** (`src/`), not extension-side —
  a user can't see an install guide living inside the thing it's teaching them to install.
- Exact icon → extension mapping (spec Constraints table): `.iso`→disc; `.zip`/`.rar`/`.7z`/`.tar`/
  `.gz`→zip; `.pdf`→pdf; `.mp3`/`.wav`/`.flac`/`.ogg`/`.m4a`→audio; `.png`/`.jpg`/`.jpeg`/`.gif`/
  `.webp`/`.bmp`/`.svg`→img; `.doc`/`.docx`/`.txt`/`.rtf`/`.odt`→doc; `.exe`/`.msi`/`.app`/`.dmg`→exe;
  everything else (including every extract job)→film.
- This machine's build note (CLAUDE.local.md): `cargo build`/`cargo test` can crash under memory
  pressure — use `CARGO_BUILD_JOBS=1 cargo build -j 1` (or `test`). `cargo tauri build`/`dev` do
  **not** accept a raw `-j` flag (errors with "unexpected argument") — only the
  `CARGO_BUILD_JOBS` env var works for those two.
- No subagent executing this plan has a real display or browser (same as round 1). Every
  "verify manually" step is the realistic static equivalent (compiles, lints, diff re-read against
  the brief) with an explicit, honest note that interactive/visual verification was not possible.

## Review Focus

- `chrome://extensions` is not a registered OS URL-protocol handler the way `http://` is — a naive
  "just call open_url and assume it worked" implementation could silently do nothing on some
  systems. The command must have a real fallback (clipboard copy), not a false-positive success.
- "OPEN FOLDER" pointing at a dev-time relative path (`../extension`) that doesn't exist at all in
  the *installed* app, because the extension folder was never declared as a bundled resource —
  must resolve through Tauri's resource-directory API, verified against the actual built output,
  not just trusted from the config file.
- The auto-pairing UI simplification breaking `chrome.storage.onChanged`'s live-refresh behavior
  if the new markup drops or renames an element `refreshPairButton()` still reads by id.
- `iconCellsForFilename`'s new per-extension checks mis-handling a filename with no extension, an
  uppercase extension (`.PDF`), or an extension that matches none of the new groups — must still
  fall back to the existing film icon, never throw or render nothing.
- The hover button's new `@font-face` rules inside the shadow root failing silently (falls back to
  a system font, pixel look lost) if a plain relative CSS `url()` is used instead of
  `chrome.runtime.getURL(...)` — a content script's injected stylesheet does not resolve relative
  URLs against the extension's own origin by default.

---

## Task 1: Hover-to-download button restyle

**Files:**
- Create: `extension/fonts/press-start-2p/PressStart2P-Regular.ttf`, `extension/fonts/press-start-2p/OFL.txt`, `extension/fonts/vt323/VT323-Regular.ttf`, `extension/fonts/vt323/OFL.txt`
- Modify: `extension/manifest.json`
- Modify: `extension/content.js`

**Interfaces:**
- Produces: `extension/fonts/` (consumed by Task 2 for the options page's own `@font-face` rules).

- [ ] **Step 1: Copy the font files from `src/fonts/` instead of re-downloading**

`src/fonts/press-start-2p/PressStart2P-Regular.ttf`+`OFL.txt` and `src/fonts/vt323/VT323-Regular.ttf`+`OFL.txt` already exist (round 1) and are the exact same OFL-licensed files this extension needs — copy them to the `extension/fonts/` paths above rather than fetching from the network again.

- [ ] **Step 2: Add a `web_accessible_resources` entry to `extension/manifest.json`**

```json
"web_accessible_resources": [
  {
    "resources": ["fonts/press-start-2p/*", "fonts/vt323/*"],
    "matches": ["<all_urls>"]
  }
]
```

Required for Manifest V3: a page's rendering engine fetches the font file by URL when it hits an `@font-face` rule, and that fetch is only allowed if the resource is declared web-accessible — without this, the fonts silently fail to load and the pill falls back to a system font with no error anywhere.

- [ ] **Step 3: Rewrite `ensureOverlay()`'s injected shadow-DOM markup and styles in `extension/content.js`**

Replace the current plain `<button>Download</button>` structure with: an `<svg>` icon (12×12 viewBox, `shape-rendering: crispEdges`, pixelated) + a `<span class="label">` for the text, matching spec Appendix A's `.pill`/`.sprite`/`.label` structure and CSS (including the `popin` keyframe, `:hover`/`:active` rules). Add two `@font-face` rules at the top of the injected `<style>` text, with `src: url(...)` computed via `chrome.runtime.getURL('fonts/press-start-2p/PressStart2P-Regular.ttf')` / the VT323 equivalent (template-literal them into the style string — a plain relative `url()` in an injected stylesheet does not resolve against the extension's own origin). Give the `<svg>` the app icon's cell data as a literal inline array (the icon never changes, so there's no need to port `buildIcon` into a content script — copy the already-computed `appCells` shape from `src/icons.js`'s `potCells.concat(plantCells)` construction as a plain JS array literal) and render it the same way `app.js`'s `renderIconInto` does (one `<rect>` per cell).

- [ ] **Step 4: Update every place that sets the button's text to target the new `<span class="label">` instead of the whole button**

`resetButtonLabel()` currently does `overlayButton.textContent = 'Download'` — change the literal text to `'HARVEST'` and retarget it (and every other `overlayButton.textContent = ...` assignment in `onButtonClick()`, plus the `setTimeout` callback's `overlayButton.textContent === 'Sent' || ... === 'Failed'` checks) to the label span, not the button itself — setting `textContent` on the button now would wipe out the `<svg>` icon added in Step 3. The transient states (`'Sending…'`, `'Sent'`, `'Failed'`) keep their existing English wording; only `'Download'` becomes `'HARVEST'`.

- [ ] **Step 5: Verify**

Run `node --check extension/content.js`. No display/browser is available in this environment to actually hover a video and see the pill — note this plainly rather than claiming it was checked. Re-read the diff once against spec Appendix A to confirm every CSS property/class name matches.

- [ ] **Step 6: Commit**

```bash
git add extension/fonts extension/manifest.json extension/content.js
git commit -m "feat: restyle the hover-to-download button as a LOADOUT harvest pill"
```

---

## Task 2: Extension options page restyle

**Files:**
- Create: `extension/options.css`
- Modify: `extension/options.html`
- Modify: `extension/options.js`

**Interfaces:**
- Consumes: `extension/fonts/` (Task 1).

- [ ] **Step 1: Create `extension/options.css` per spec Appendix B's `<style>` block, verbatim**

Include the two `@font-face` rules (same `extension/fonts/...` paths as Task 1 — a stylesheet file loaded via a normal `<link>` in `options.html` resolves relative URLs against its own file location, so this one does **not** need `chrome.runtime.getURL()`, unlike Task 1's content-script-injected case).

- [ ] **Step 2: Rewrite `extension/options.html`'s body to match spec Appendix B's structure, keeping every existing element id**

`status` (the status text span — wrap it in the new `.statusrow`/`.statusdot` markup), `pair-btn` (becomes the restyled `.pairbtn2` "PAIR MANUALLY" button — keep the id `pair-btn` so `options.js` needs no selector changes), `forget-btn` (becomes `.forgetbtn` "FORGET PAIRING", same id). The mockup's own markup has no element for transient error/status messages (`pair-error`, `forget-status`) since it's a static visual mockup — keep those two elements too, with their exact existing ids, styled simply (small text, `var(--berry)` for errors) since `options.js`'s existing `errorEl.textContent = ...`/`forgetStatusEl.textContent = ...` calls need somewhere to render into. Add the `<link rel="stylesheet" href="options.css">` and the app-icon `<svg>` in `.headicon` (12×12 viewBox, same literal `appCells` array as Task 1 — or factor it into one small shared snippet both files `<script>`-include if that's cleaner; either is fine).

- [ ] **Step 3: Update `refreshPairButton()` in `extension/options.js`**

Keep its existing read (`chrome.storage.local.get('dmToken')`). Change what it does with the result: when `dmToken` is set (already paired), disable the `PAIR MANUALLY` button (`pairBtn.disabled = true`) and visually dim it (a `.pairbtn2[disabled]` CSS rule, e.g. `opacity:.5;cursor:default;pointer-events:none`) — do **not** change its text to "Paired" (the status card above it already conveys that). When `dmToken` is absent, leave it enabled with its normal "PAIR MANUALLY" label. This keeps the function's existing call sites (`DOMContentLoaded`, `pairBtn`'s own click handler, the `chrome.storage.onChanged` listener) and existing read logic completely unchanged — only the disabled/enabled visual state changes, never the button's text.

- [ ] **Step 4: Update `checkAppRunning()`'s result handling in `initOptionsPage()`**

`statusEl.textContent` becomes `'FIELD CONNECTED'` (running) or `'FIELD NOT CONNECTED'` (not running); toggle an `.off` class on the status text element in the not-running case (drives `--berry` via the CSS already written in Step 1). The `.statusdot`'s blink animation runs unconditionally (ambient cue, not state-dependent) — no JS needed for it, it's pure CSS per spec Appendix B.

- [ ] **Step 5: Verify**

Run `node --check extension/options.js`. Confirm by reading the diff that every id `options.js` references (`status`, `pair-btn`, `pair-error`, `forget-btn`, `forget-status`) still exists in the rewritten `options.html`. No display/browser available to actually open the options page — note this plainly.

- [ ] **Step 6: Commit**

```bash
git add extension/options.css extension/options.html extension/options.js
git commit -m "feat: restyle the extension options page"
```

---

## Task 3: Browser Companion Setup Guide popup + real open-page/open-folder commands

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `tauri-plugin-opener`, `tauri-plugin-clipboard-manager`)
- Modify: `src-tauri/src/main.rs` (register both plugins, add two commands to `generate_handler!`)
- Modify: `src-tauri/src/commands.rs` (two new commands)
- Modify: `src-tauri/capabilities/default.json` (their permissions)
- Modify: `src-tauri/tauri.conf.json` (bundle the `extension/` folder as a resource)
- Modify: `src/index.html` (new Settings row + third popup)
- Modify: `src/styles.css` (port the setup guide's step/tip classes)
- Modify: `src/app.js` (wire the popup open/close and both action buttons)

**Interfaces:**
- Consumes: round 1's `.panel`/`.panel-card`/`.popup-titlebar`/`openPanel`/`closePanel` pattern
  (`src/app.js`, `src/styles.css`); `appCells`/`renderIconInto` (`src/icons.js`/`src/app.js`).
- Produces: Tauri commands `open_extensions_page() -> Result<String, String>` (returns `"opened"`
  or `"copied"` so the frontend can show the right confirmation text) and
  `open_extension_folder() -> Result<(), String>`.

- [ ] **Step 1: Add dependencies to `src-tauri/Cargo.toml`**

`tauri-plugin-opener` and `tauri-plugin-clipboard-manager` (latest versions compatible with this
project's Tauri 2.12 — check `src-tauri/Cargo.lock` after `cargo build` to confirm the resolved
versions, same way the project's other Tauri-ecosystem plugins are pinned).

- [ ] **Step 2: Register both plugins in `src-tauri/src/main.rs`**

Add `.plugin(tauri_plugin_opener::init())` and `.plugin(tauri_plugin_clipboard_manager::init())`
to the existing `tauri::Builder::default()` chain (alongside `tauri_plugin_single_instance`/
`tauri_plugin_autostart`) — order relative to those two doesn't matter, neither new plugin has the
single-instance plugin's "must be first" constraint.

- [ ] **Step 3: Implement `open_extensions_page` in `src-tauri/src/commands.rs`**

```rust
#[tauri::command]
pub async fn open_extensions_page(app: tauri::AppHandle) -> Result<String, String>
```

Attempt opening `"chrome://extensions"` via `tauri-plugin-opener`'s open-URL API. On success,
return `Ok("opened".to_string())`. On any error from that attempt, fall back to writing the string
`"chrome://extensions"` to the OS clipboard via `tauri-plugin-clipboard-manager`'s API and return
`Ok("copied".to_string())` (the clipboard write itself failing is the only real error case left —
return `Err(...)` only then). The frontend (Step 8) shows different confirmation text for the two
`Ok` results.

- [ ] **Step 4: Implement `open_extension_folder` in `src-tauri/src/commands.rs`**

```rust
#[tauri::command]
pub fn open_extension_folder(app: tauri::AppHandle) -> Result<(), String>
```

Resolve the bundled extension folder's real path via Tauri's resource-directory API (e.g.
`app.path().resolve("extension", tauri::path::BaseDirectory::Resource)`, matching whatever the
Step 6 bundle-resources mapping below actually names it as), then open it via
`tauri-plugin-opener`'s open-path/reveal-in-folder API. Map any error (resolve failure, open
failure) to `Err(<message>.to_string())`.

- [ ] **Step 5: Register both commands and add their permissions**

Add `commands::open_extensions_page` and `commands::open_extension_folder` to `main.rs`'s
`tauri::generate_handler![...]` list. Add whatever `tauri-plugin-opener` permission identifier(s)
these two calls actually need to `src-tauri/capabilities/default.json`'s `"permissions"` array —
confirm the exact identifier names against `src-tauri/gen/schemas/acl-manifests.json` if present
(same technique round 1 used for `core:window:*` after discovering `core:window:default` didn't
cover what was needed), rather than guessing a `*:default` name that may not grant what's called.
Add `tauri-plugin-clipboard-manager`'s write-text permission the same way.

- [ ] **Step 6: Bundle the `extension/` folder as an installer resource in `src-tauri/tauri.conf.json`**

Add a `"resources"` entry to the `"bundle"` section pointing at `../extension` (relative to
`tauri.conf.json`'s own directory). Confirm the exact accepted syntax (a glob-pattern array like
`["../extension/**/*"]`, or a source→target mapping object) against this project's installed
`tauri-build`/Tauri schema — do not guess; check the schema file or Tauri's own config
documentation for the exact version pinned in `Cargo.toml`.

- [ ] **Step 7: Add the popup's markup and styles**

In `src/index.html`: a new Settings row ("Browser Companion" / "Set up the extension's
hover-to-download button" / a `.changebtn`-styled "SET UP" button), and a new
`<section id="browser-setup-panel" class="panel hidden">` containing a `.panel-card` with a
`.popup-titlebar` ("BROWSER COMPANION SETUP" + its own app-icon `<svg>` + close `X`, same pattern
as the other two popups) and a `.panel-card-body` with spec Appendix C's intro paragraph, four
numbered steps (`.step`/`.stepnum`/`.steptext`/`.stitle`/`.shint`, with `id="setup-open-page-btn"`
and `id="setup-open-folder-btn"` on the two `.stepbtn`s per the spec), the `.tip` box, and the
`.actions` row with "SKIP FOR NOW" (`id="setup-skip-btn"`) / "✓ I'VE INSTALLED IT"
(`id="setup-done-btn"`). In `src/styles.css`: port `.step`/`.stepnum`/`.steptext`/`.stitle`/
`.shint`/`.stepbtn`/`.tip` verbatim from spec Appendix C (none of these classes exist yet).

- [ ] **Step 8: Wire it up in `src/app.js`**

A new Settings-row button opens this popup the same way the existing `shedbtn` opens Settings
(`openPanel`). `setup-skip-btn` and `setup-done-btn` both just `closePanel` this popup (no new
persisted "seen this guide" state — nothing in this round asks for one). `setup-open-page-btn`
calls `invoke("open_extensions_page")` and shows a short inline confirmation reflecting which
`Ok` value came back (e.g. "Opened chrome://extensions in your browser." vs. "Copied
chrome://extensions — paste it into your browser's address bar."). `setup-open-folder-btn` calls
`invoke("open_extension_folder")`, surfacing any error the same way other panels show errors
(reuse the existing `showError`/`hideError` pattern). Render this popup's title-bar icon via
`renderIconInto`, same as the other two popups.

- [ ] **Step 9: Verify**

Run `CARGO_BUILD_JOBS=1 cargo build -j 1` in `src-tauri` to confirm the new plugins/commands/
capabilities compile and validate. Run `CARGO_BUILD_JOBS=1 cargo tauri build` once to confirm the
bundle actually places `extension/`'s files somewhere under the built output (inspect
`src-tauri/target/release/resources/` or equivalent in the build output) — this is the one thing
in this task that a config-file read-through cannot confirm on its own. `node --check src/app.js`.
No display/browser available to actually click the two buttons and see a real browser window or
file-explorer window open — note this plainly; this is also the one step in this whole plan where
a human with a display should specifically re-verify before calling the task done, since the
open-URL fallback behavior (Step 3) was never actually exercised against a real `chrome://`
attempt in this environment.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/main.rs src-tauri/src/commands.rs src-tauri/capabilities/default.json src-tauri/tauri.conf.json src/index.html src/styles.css src/app.js
git commit -m "feat: add the Browser Companion Setup Guide popup with real open-page/open-folder commands"
```

---

## Task 4: Icon completeness (PDF, audio, image, doc, exe)

**Files:**
- Modify: `src/icons.js`
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `buildIcon` (round 1, `src/icons.js`).
- Produces: `docShape()`, `pdfCells`, `audioCells`, `imgCells`, `docCells`, `exeCells` (exported
  from `src/icons.js`).

- [ ] **Step 1: Add `docShape()` and the five new exported constants to `src/icons.js`, copied verbatim from spec Appendix D**

This is copy-exactly reference material (same convention as round 1's `buildIcon` port) — every
palette hex value and shape coordinate must match the appendix exactly, not just "look similar".

- [ ] **Step 2: Rewrite `iconCellsForFilename` in `src/app.js` to the full mapping table**

```js
function iconCellsForFilename(filename) {
  const lower = String(filename ?? "").toLowerCase();
  const byExt = {
    iso: discCells,
    zip: zipCells, rar: zipCells, "7z": zipCells, tar: zipCells, gz: zipCells,
    pdf: pdfCells,
    mp3: audioCells, wav: audioCells, flac: audioCells, ogg: audioCells, m4a: audioCells,
    png: imgCells, jpg: imgCells, jpeg: imgCells, gif: imgCells, webp: imgCells, bmp: imgCells, svg: imgCells,
    doc: docCells, docx: docCells, txt: docCells, rtf: docCells, odt: docCells,
    exe: exeCells, msi: exeCells, app: exeCells, dmg: exeCells,
  };
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  return byExt[ext] ?? filmCells;
}
```

Import the five new names from `./icons.js` alongside the existing import line.

- [ ] **Step 3: Verify**

Run `node --check src/app.js`. Write a short throwaway check (deleted after, per round 1's Task 2
convention) importing `iconCellsForFilename`-equivalent logic or the module directly and asserting
a handful of filenames (`"report.PDF"`, `"song.mp3"`, `"noext"`, `"archive.rar"`,
`"video.mkv"`) each resolve to the expected cell array per the mapping table, including the
uppercase-extension and no-extension cases from this plan's Review Focus. No display/browser
available to see the icons actually rendered in a row — note this plainly.

- [ ] **Step 4: Commit**

```bash
git add src/icons.js src/app.js
git commit -m "feat: add PDF/audio/image/doc/exe icons and extend the extension-to-icon mapping"
```

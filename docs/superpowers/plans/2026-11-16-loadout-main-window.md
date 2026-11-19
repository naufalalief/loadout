# LOADOUT Main Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the desktop app's single page (`src/index.html`, `src/styles.css`, `src/app.js`) into the "LOADOUT FARM LOG" pixel-art visual design, and switch the main window to a frameless window with a real custom title bar, without changing any existing backend behavior.

**Architecture:** Pure frontend reskin plus one window-chrome change. A new `src/icons.js` ES module provides the shared pixel-icon generator (`buildIcon`) and every icon's cell data, imported by `app.js`. `app.js`'s `createRow`/`updateRow`/`actionsFor*` are rewritten to build the new row shape (single meta line, popovers instead of always-visible forms, relabeled buttons) while every `invoke()` call, the 1s poll loop, and every status-gated button-availability rule stays behaviorally identical. `src-tauri/tauri.conf.json` switches the main window to `decorations:false`; the new HTML title bar drives real minimize/maximize/close via Tauri's window API.

**Tech Stack:** Vanilla HTML/CSS/JS (native ES modules, no bundler), Tauri 2.12 JS API via `window.__TAURI__` (`withGlobalTauri: true` already set).

**Spec:** `docs/superpowers/specs/2026-11-16-loadout-main-window-design.md`

## Global Constraints

- No build step, no bundler, no framework — native ES modules (`<script type="module">`) are fine since they're a browser feature, not a bundler.
- Fonts (Press Start 2P, VT323) are self-hosted under `src/fonts/`, never loaded from Google Fonts at runtime.
- Frameless main window (`"decorations": false`), custom HTML title bar wired to real window controls (minimize/maximize-toggle/close), window title `"LOADOUT FARM LOG"` (spec: Constraints → Window chrome).
- Exact color tokens (spec Appendix A `:root`): `--sky:#7ec8e8; --wood:#c98f4e; --wood-dark:#8a5a28; --cream:#fff8ea; --ink:#3a2410; --ink-dim:#8a6b42; --stamina:#ff8a3c; --rp:#4ab8e8; --berry:#e8503c; --leaf:#5aa83c;`. Row separator `#e8dab8`. Status bar background `#b07f42`.
- Status→badge-word→color mapping and action-button label mapping are exact (spec Constraints tables) — not open to rephrasing.
- The popover `<input>` must have `min-width:0` (spec Appendix D) — this exact bug (input overflowing the popover, pushing its button out) was hit once already in the mockup.
- Do **not** implement the three Settings toggle rows ("Harvest chime", "Auto-replant failed crops", "Start with the season") — no backend field exists for any of them (spec Constraints, owner-confirmed).
- Every existing `invoke()` call name and argument shape, the 1000ms poll interval, and every current status-gated action-availability rule in `actionsForDownload`/`actionsForExtract` must survive unchanged — only rendering changes.
- Every interactive element (buttons, the title bar's `_`/`□`/`X`, popover triggers and their contents) gets the same press/hover micro-interaction used throughout the mockups: `transition: transform .08s ease, box-shadow .08s ease, filter .1s ease;` plus `:hover{filter:brightness(1.05–1.1)}` and `:active{transform:translate(Npx,Npx) matching that element's own box-shadow depth; box-shadow:none}`. Progress-bar width transitions over `.4s ease`. This applies to every button-like element added or restyled in Tasks 3, 4, 5, 6, and 7 — each of those tasks' CSS steps must include it, not just the mockup's exact colors/layout.

## Review Focus

- Any `invoke()` call's command name or argument keys drift during the rewrite (e.g. `choose_extract_format`'s `formatLabel` arg, `set_download_speed_limit`'s `bytesPerSec` arg, `remove_download_and_delete_file`'s confirm-dialog gate) — a typo here silently breaks a button with no visible error until clicked.
- The new `LIMIT` button appears on a `Completed` or `Canceled` row (it must not — today's `limitable` rule, `!["Completed","Canceled"].includes(status)`, must keep gating it exactly).
- The new `LIMIT` button appears on an extract-job row (it must not — no speed-limit command exists for extract jobs; only the `PICK ▾` button belongs there, and only while `AwaitingFormatChoice`).
- The popover `<input>` is missing `min-width:0` (regression of the exact bug the spec flags) — visually, a long placeholder/typed value pushes the `SET` button outside the popover's border.
- Any of the three unbacked Settings toggle rows end up in the shipped `src/index.html` (even inert/disabled) instead of being left out entirely.

---

## Task 1: Self-host the two fonts

**Files:**
- Create: `src/fonts/press-start-2p/PressStart2P-Regular.ttf`, `src/fonts/press-start-2p/OFL.txt`
- Create: `src/fonts/vt323/VT323-Regular.ttf`, `src/fonts/vt323/OFL.txt`

**Interfaces:**
- Produces: two local font files + their OFL license texts, for Task 4 to reference via `@font-face`.

- [ ] **Step 1: Download the font files and their licenses**

Download from the Google Fonts GitHub repo (OFL-licensed):
- `https://raw.githubusercontent.com/google/fonts/main/ofl/pressstart2p/PressStart2P-Regular.ttf` → `src/fonts/press-start-2p/PressStart2P-Regular.ttf`
- `https://raw.githubusercontent.com/google/fonts/main/ofl/pressstart2p/OFL.txt` → `src/fonts/press-start-2p/OFL.txt`
- `https://raw.githubusercontent.com/google/fonts/main/ofl/vt323/VT323-Regular.ttf` → `src/fonts/vt323/VT323-Regular.ttf`
- `https://raw.githubusercontent.com/google/fonts/main/ofl/vt323/OFL.txt` → `src/fonts/vt323/OFL.txt`

If any URL 404s, the repo's `ofl/pressstart2p/` or `ofl/vt323/` directory listing on GitHub has the current exact filename — use that instead. `.ttf` (not `.woff2`) is the pinned format here: these two files are small, and avoiding a conversion step keeps this build-step-free.

- [ ] **Step 2: Verify the downloads**

Check each `.ttf` is a valid, non-trivial binary (e.g. `file src/fonts/press-start-2p/PressStart2P-Regular.ttf` reports a TrueType font, and the file size is a few KB to a few hundred KB, not 0 bytes or an HTML error page saved by mistake).

- [ ] **Step 3: Commit**

```bash
git add src/fonts
git commit -m "chore: self-host Press Start 2P and VT323 fonts"
```

---

## Task 2: Shared pixel-icon module

**Files:**
- Create: `src/icons.js`

**Interfaces:**
- Produces (ES module exports, ported verbatim from spec Appendix A's `buildIcon` algorithm and Appendices A/C's per-icon cell data):
  - `export function buildIcon(filled, pal)` — `filled` is a `{ "x,y": true | "#hexcolor" }` map, `pal` is `{ hi, base, sh }`; returns `Array<{x:number, y:number, fill:string}>` (12×12 grid, auto-shaded per-row by min/max-x into `hi`/`base`/`sh`, plus an auto-computed 1px outline ring in `'#3a2410'` around the shape).
  - `export const appCells` — pot+sprout, the app icon (spec Appendix A's `potCells.concat(plantCells)` construction).
  - `export const discCells` — ISO icon.
  - `export const zipCells` — ZIP icon.
  - `export const filmCells` — MP4/video icon (used as-is for normal video rows; a withered row recolors it via a literal `fill: 'var(--berry)'` override at render time, not a different export).
  - `export const wrenchCells` — status-bar "Tool Shed" icon (spec Appendix A's wrench cell data).
  - `export const seedCells` — Add Download panel icon (spec Appendix C's seed cell data).

- [ ] **Step 1: Implement `buildIcon` and the six exported cell constants in `src/icons.js`**

Copy the algorithm and cell data verbatim from spec Appendix A (`buildIcon`, `discPal`/`disc`, `zipPal`/`zip`, `filmPal`/`film`, `potPal`/`pot`, `leafPal`/`plant`, `wrenchPal`/`wrench`) and Appendix C (`seedPal`/`seed`). `GRID = 12`, outline color `'#3a2410'`, exactly as in the appendices — this is copy-this-exactly reference material, not something to redesign.

- [ ] **Step 2: Verify manually**

Add a temporary `<script type="module">import { appCells } from './icons.js'; console.log(appCells.length);</script>` to `index.html` (or use the browser devtools console once Task 4 wires it in), run `cargo tauri dev`, and confirm no console errors and a non-empty cell array. Remove the temporary snippet before committing if added.

- [ ] **Step 3: Commit**

```bash
git add src/icons.js
git commit -m "feat: add shared pixel-icon generator module"
```

---

## Task 3: Frameless window with a real custom title bar

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json` (only if Step 4's manual check finds it necessary)
- Modify: `src/index.html` (title bar markup)
- Modify: `src/styles.css` (title bar styles)
- Modify: `src/app.js` (wire the three window-control buttons)

**Interfaces:**
- Consumes: `appCells`, `buildIcon` from Task 2 (`src/icons.js`) for the title bar's app icon.
- Produces: a frameless main window whose HTML title bar's three buttons call the real Tauri window API.

- [ ] **Step 1: Set `"decorations": false` and `"title": "LOADOUT FARM LOG"` on the `"main"` window entry in `src-tauri/tauri.conf.json`**

- [ ] **Step 2: Add the title bar markup to `src/index.html`**

A bar with `data-tauri-drag-region` on its own container (so the window can be dragged from it, per Tauri's drag-region convention), containing: the app icon (`<svg>` rendered from `appCells` via `buildIcon`, same pattern as spec Appendix A's `<sc-for>` templating reimplemented as plain JS — Task 4 will handle general "render an icon into an `<svg>`" plumbing, but the title bar's own icon can be rendered directly in `app.js`'s init code since it never changes), the `"LOADOUT FARM LOG"` wordmark, and three buttons with ids `#win-minimize`, `#win-maximize`, `#win-close`. Exclude the buttons themselves from the drag region (so clicking them doesn't start a drag) — per the mockup's structure (spec Appendix A `.titlebar`/`.winbtns`), put `data-tauri-drag-region` on `.titlebar` but not on `.winbtns` or its children.

- [ ] **Step 3: Style the title bar in `src/styles.css` per spec Appendix A's `.titlebar`/`.tgroup`/`.appicon`/`.t`/`.winbtns`/`.wb`/`.wb.close` rules, including the `.wb` hover/press transition from Global Constraints**

- [ ] **Step 4: Wire the three buttons in `src/app.js`**

```js
const { getCurrentWindow } = window.__TAURI__.window;
const appWindow = getCurrentWindow();
document.getElementById("win-minimize").addEventListener("click", () => appWindow.minimize());
document.getElementById("win-maximize").addEventListener("click", () => appWindow.toggleMaximize());
document.getElementById("win-close").addEventListener("click", () => appWindow.close());
```

If `window.__TAURI__.window` or `getCurrentWindow` isn't the exact path for the Tauri JS runtime actually bundled with this project's Tauri 2.12 (confirm by checking what's available in the webview devtools console at runtime), use whatever the equivalent current-window accessor is — the three method names (`minimize`/`toggleMaximize`/`close`) are what matter.

- [ ] **Step 5: Verify manually**

Run: `cargo tauri dev`
Expected: no native OS title bar is visible; the custom wood-colored bar with the pot+sprout icon and "LOADOUT FARM LOG" text is drawn instead; dragging that bar moves the window; clicking `_` minimizes, clicking `□` toggles maximize/restore, clicking `X` closes the app (not just hides — the existing hide-on-close tray behavior, if any, is unaffected by this task since that's wired to the window's `CloseRequested` event, not this button). If a window-control call throws a permission error in the devtools console, add `"core:window:default"` to the `"permissions"` array in `src-tauri/capabilities/default.json` and re-verify.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/capabilities/default.json src/index.html src/styles.css src/app.js
git commit -m "feat: switch to a frameless window with a custom title bar"
```

---

## Task 4: Visual shell — fonts, color tokens, add-crop row, status bar, empty state

**Files:**
- Modify: `src/styles.css` (full token set, `@font-face`, `.addrow`, `.statusbar`, `.shedbtn`, `.empty`/`.potslot`/`.etitle`/`.esub`/`.ebtn`)
- Modify: `src/index.html` (`.addrow` button, status bar markup, empty-state markup)
- Modify: `src/app.js` (render the wrench icon into `.shedbtn`; toggle between the empty-state markup and the queue list; status bar task/working counts)

**Interfaces:**
- Consumes: `buildIcon`, `wrenchCells`, `appCells` (empty-state's pot-only icon uses its own cell data, below) from Task 2; the frameless window shell from Task 3.
- Produces: `renderIconInto(svgEl, cells)` helper in `app.js` — `(svgEl: SVGElement, cells: Array<{x,y,fill}>) => void`, clears and repopulates `svgEl` with one `<rect>` per cell (`x`, `y`, `width="1"`, `height="1"`, `fill`). Every later task (icons per row, in Task 5) reuses this helper instead of re-implementing the `<rect>`-building loop.

- [ ] **Step 1: Add `@font-face` rules and the full color-token `:root` block to `src/styles.css`**

`@font-face` for `'Press Start 2P'` → `src/fonts/press-start-2p/PressStart2P-Regular.ttf`, and `'VT323'` → `src/fonts/vt323/VT323-Regular.ttf`. Color tokens exactly as listed in Global Constraints above. Set `body`'s `font-family` to `'VT323', monospace` and background to `var(--sky)`.

- [ ] **Step 2: Implement `renderIconInto(svgEl, cells)` in `src/app.js`**

```js
function renderIconInto(svgEl, cells) {
  svgEl.replaceChildren(...cells.map((c) => {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", c.x); rect.setAttribute("y", c.y);
    rect.setAttribute("width", "1"); rect.setAttribute("height", "1");
    rect.setAttribute("fill", c.fill);
    return rect;
  }));
}
```

- [ ] **Step 3: Add the "+ NEW CROP" row above the queue list in `src/index.html`, styled per spec Appendix A's `.addrow` (including its hover/press transition from Global Constraints)**

Clicking it calls the existing `openPanel(addPanelEl)` logic (today's "Add Download" button already does this — this new element replaces/supplements that button per the mockup's layout; keep exactly one way to open the panel, don't leave two redundant buttons).

- [ ] **Step 4: Add the status bar (`.statusbar`) to `src/index.html`, styled per spec Appendix A, with a `.shedbtn` (including its hover/press transition from Global Constraints) rendering `wrenchCells` via `renderIconInto`**

Status bar text: `"<N> TASKS"` where N is the current merged `items.length`, and `"<M> WORKING"` where M is the count of items whose badge word (Task 5) is `WORKING`. Clicking `.shedbtn` calls the existing settings-open logic (today's "Settings" button).

- [ ] **Step 5: Implement the empty state per spec Appendix B**

Add the empty-state markup (potslot icon, "NO CROPS PLANTED YET", explanatory text, "+ NEW CROP" button, its `.ebtn` styled with the hover/press transition from Global Constraints) to `index.html`, hidden by default. In `refreshList()`, toggle between the empty-state block and `#queue-list` based on `items.length` (replacing today's plain `<p id="empty-state">`). The empty-state's "+ NEW CROP" button opens the Add Download panel, same as Step 3's button. Use this pot-only cell data (no plant) for its icon, per spec Appendix B:

```js
export const emptyPotCells = buildIcon({
  // x,y -> true for rows 6-10 forming a wider, plant-less pot
}, { hi: '#e8a878', base: '#c9793e', sh: '#8a4f24' });
```

Port the exact coordinates from spec Appendix B's `pot` object into a new `emptyPotCells` export in `src/icons.js` (Task 2's file — add this export there, not a new module).

- [ ] **Step 6: Status bar shows `"0 TASKS"` / replace the second span with `"FIELD IS QUIET"` when the list is empty**

Per spec Appendix B.

- [ ] **Step 7: Remove the old `<header>` element from `src/index.html` (the `<h1>Download Manager</h1>` plus the `.header-actions` div with `#open-add-btn`/`#open-settings-btn`)**

Its two roles are now fully covered elsewhere: branding by the Task 3 title bar, and opening the two panels by this task's `.addrow` "+ NEW CROP" (Step 3) and `.shedbtn` (Step 4). Re-point whatever click listeners today's `app.js` attaches to `#open-add-btn`/`#open-settings-btn` onto the new elements instead of leaving two ways to do the same thing (this task's own Step 3 already says as much for the add-panel button — this step is the other half, removing the now-dead originals and their listeners).

- [ ] **Step 8: Verify manually**

Run: `cargo tauri dev`
Expected: with no downloads queued, the empty-state illustration shows instead of a blank list, and the status bar reads "0 TASKS" / "FIELD IS QUIET". Adding any download (even one that will fail) makes the empty state disappear and the status bar switch to the "<N> TASKS" / "<M> WORKING" format. The "+ NEW CROP" button (both the one above the list and the one in the empty state) opens the same Add Download panel the old "Add Download" header button opened. The Tool Shed wrench icon renders in the status bar and opens Settings.

- [ ] **Step 9: Commit**

```bash
git add src/styles.css src/index.html src/app.js src/icons.js
git commit -m "feat: add LOADOUT visual shell, status bar, and empty state"
```

---

## Task 5: Row rendering rewrite — badges, relabeled actions, icons, popovers

**Files:**
- Modify: `src/app.js` (`createRow`, `updateRow`, `updateDownloadRow`, `updateExtractRow`, `actionsForDownload`, `actionsForExtract`)
- Modify: `src/styles.css` (`.row`, `.slot`, `.info`, `.fname`, `.meta`, `.sword`, `.stambar-*`, `.actions`, `.actbtn`, `.popover` and its contents)
- Modify: `src/icons.js` (no new exports needed beyond Task 2/4 — this task only *consumes* them)

**Interfaces:**
- Consumes: `renderIconInto` (Task 4), `discCells`/`zipCells`/`filmCells` (Task 2), the existing `invoke()` call set and status-gating rules in today's `actionsForDownload`/`actionsForExtract`/`updateDownloadRow`/`updateExtractRow` (unchanged — only labels/structure change, not which calls exist or when buttons appear).
- Produces: rows matching spec Appendix A's shape — one meta line per row, a `LIMIT`-triggered speed-limit popover (download rows only, same `limitable` gate as today), a `PICK ▾`-triggered format-pick popover (extract rows, `AwaitingFormatChoice` only).

- [ ] **Step 1: Add the status→badge-word→color mapping as data in `app.js`**

```js
const DOWNLOAD_BADGE = {
  Downloading: ["WORKING", "var(--stamina)"],
  Paused: ["RESTING", "var(--ink-dim)"],
  Queued: ["WAITING", "var(--ink-dim)"],
  Completed: ["SHIPPED", "var(--leaf)"],
  Failed: ["WITHERED", "var(--berry)"],
  Canceled: ["CANCELED", "var(--ink-dim)"],
};
const EXTRACT_BADGE = {
  Probing: ["SCOUTING", "var(--wood-dark)"],
  Downloading: ["WORKING", "var(--stamina)"],
  AwaitingFormatChoice: ["AWAITING", "var(--rp)"],
  Completed: ["SHIPPED", "var(--leaf)"],
  Failed: ["WITHERED", "var(--berry)"],
  Canceled: ["CANCELED", "var(--ink-dim)"],
};
```

- [ ] **Step 2: Rewrite `createRow(item)` to build the new shape per spec Appendix A**

Give every `.actbtn` the hover/press transition from Global Constraints. New structure: `.slot` (icon — `discCells` for an ISO-ish filename, `zipCells` for a ZIP-ish filename, `filmCells` otherwise, matching whatever extension-sniffing the current code already does for icon choice, if any — if today's code has no per-extension icon logic yet, add a minimal one keyed on the filename's extension: `.iso` → disc, `.zip` → zip, everything else → film; this is new icon *selection* logic the mockup implies but the real app's data model doesn't currently branch on), `.info` (`.fname`, one `.meta` line with a `.sword`-styled badge span + the size/speed or error text, a `.stambar-outer`/`.stambar-fill` progress bar), `.actions` (built per Step 4/5 below), and a `.popover` (hidden by default, see Step 6).

- [ ] **Step 3: Rewrite `updateDownloadRow(els, download)` to set the new elements**

Badge word/color from `DOWNLOAD_BADGE[download.status]`. Meta line: `<badge> — <sizeText>` normally, or when `download.error` is set, append the error text after the badge in `var(--berry)` (matching spec Appendix A's WITHERED row, which colors both the badge and the message berry). Progress bar width unchanged logic (`progressPercent`), just restyled, with the `.stambar-fill` width transition (`.4s ease`) from Global Constraints.

- [ ] **Step 4: Rewrite `actionsForDownload(download)` to return the new labels**

Same conditions as today, new labels: `Pause`→`REST`, `Resume`→`WORK`, `Retry`→`REPLANT`, `Cancel`→`✕` (icon-only, `.danger`), `Remove`→`PULL` (`.danger` only when `status === "Failed"`, plain otherwise — matches spec Appendix A, where the Completed row's PULL is plain and the Failed row's PULL is `.danger`). Additionally, when `limitable` (today's exact rule: `!["Completed", "Canceled"].includes(download.status)`), include a `LIMIT` action that toggles this row's popover open/closed instead of invoking anything directly.

- [ ] **Step 5: Rewrite `actionsForExtract(job)` to return the new labels**

`Cancel`→`✕` (`.danger`), `Retry`→`REPLANT`, `Remove`→`PULL`. Replace the `AwaitingFormatChoice` inline `<select>`+"Download" button entirely with a single `PICK ▾` action that toggles this row's popover open/closed. Extract rows never get a `LIMIT` action (no backend command exists for it).

- [ ] **Step 6: Implement the two popovers per spec Appendix D**

Each row's `.popover` is empty/hidden until its trigger button (`LIMIT` or `PICK ▾`) is clicked, which toggles a `hidden` class and (for `PICK ▾`) populates the popover's `.pick` rows from `job.formats` (same data source as today's `<select>` options). A `.popover input` **must** have `min-width:0` in its CSS rule (Global Constraints — this exact bug already happened once in the mockup). Clicking the `LIMIT` popover's `SET` button calls `invoke("set_download_speed_limit", { id, bytesPerSec: parseSpeedLimit(input.value) })` (today's exact call) and closes the popover. Clicking a `.pick` row calls `invoke("choose_extract_format", { id: job.id, formatLabel: <that option's label> })` (today's exact call) directly — no separate confirm step.

- [ ] **Step 7: Verify manually**

Run: `cargo tauri dev`. Queue several downloads of different extensions (`.iso`, `.zip`, a video URL) and at least one that will fail (e.g. a bad URL) to see every badge state. Confirm: each row shows exactly one meta line with the correct badge word/color; action buttons show the new labels; `LIMIT` never appears on a Completed/Canceled row or on any extract-job row; clicking `LIMIT` opens a popover whose `SET` button actually changes the running download's speed (watch the transfer rate change); for a video URL that needs format selection, clicking `PICK ▾` opens a popover listing real resolutions from the backend and clicking one starts that download immediately; typing a long value into the speed-limit popover's input never pushes the `SET` button outside the popover's border.

- [ ] **Step 8: Commit**

```bash
git add src/app.js src/styles.css
git commit -m "feat: rewrite queue rows with badges, relabeled actions, and popovers"
```

---

## Task 6: Add Download panel restyle

**Files:**
- Modify: `src/index.html` (`#add-panel` contents)
- Modify: `src/styles.css` (`.hero`, `.heroslot`, `.herotext`, `.field`, `.btn`)
- Modify: `src/icons.js` (add `seedCells` export — already specified in Task 2; this task just consumes it)
- Modify: `src/app.js` (render `seedCells` into the hero icon)

**Interfaces:**
- Consumes: `seedCells`, `renderIconInto` from Tasks 2/4. The existing `#add-form`/`#add-url`/`#add-filename`/`#add-error`/`add_download` invoke flow (unchanged).

- [ ] **Step 1: Replace `#add-panel`'s contents per spec Appendix C, keeping the existing element ids (`add-url`, `add-filename`, `add-error`, the submit/cancel buttons)**

Add the `.hero` block (seed icon + explanatory text) above the existing form fields. Restyle the URL and filename fields and the Cancel/Submit buttons per Appendix C's `.field`/`.btn` rules, including `.btn`'s hover/press transition from Global Constraints. The "SAVE TO FIELD" label is cosmetic only — the underlying `add-filename` input keeps its real meaning (optional filename, not a folder path); don't change its placeholder/behavior to imply it's a folder picker (spec Appendix C note).

- [ ] **Step 2: Verify manually**

Run: `cargo tauri dev`, open Add Download. Expected: the seed icon and intro text appear above the form; submitting a valid URL still adds a download; submitting an invalid one still shows `#add-error` in the restyled layout; Cancel still closes the panel without adding anything.

- [ ] **Step 3: Commit**

```bash
git add src/index.html src/styles.css src/app.js
git commit -m "feat: restyle the Add Download panel"
```

---

## Task 7: Settings panel restyle

**Files:**
- Modify: `src/index.html` (`#settings-panel` contents)
- Modify: `src/styles.css` (`.srow`, `.pathbox`, `.smallinput`, `.changebtn`, `.stepper`/`.sbtn`/`.sval` if a stepper replaces the max-concurrent `<input type="number">`, `.about`/`.aboutslot`/`.aboutver`)
- Modify: `src/app.js` (render `appCells` into the about-row icon; any stepper wiring if Step 1's choice needs it)

**Interfaces:**
- Consumes: `appCells`, `renderIconInto` from Tasks 2/4. The existing `settings-download-dir`/`settings-max-concurrent`/`settings-speed-limit`/`check-ytdlp-update-btn`/`get_settings`/`set_settings`/`check_ytdlp_update` flow (unchanged).

- [ ] **Step 1: Replace `#settings-panel`'s contents per spec Appendix C, keeping the existing element ids and real fields only**

Port: Field folder (`settings-download-dir` — keep it an editable text input; do not add a native folder-picker dialog, since no such Tauri command exists in `src-tauri/src/commands.rs` today and adding one is out of scope), Crops growing at once (`settings-max-concurrent` — either keep it a plain number input restyled, or implement it as the mockup's `-`/value/`+` stepper purely as a frontend control that still writes into the same hidden/underlying value `set_settings` reads — implementer's choice, both are reasonable), Watering limit (`settings-speed-limit`), Harvest tools (`check-ytdlp-update-btn` + its status text). Add the `.about` footer (app icon + "LOADOUT FARM LOG — v1.0"). Give every button-like control (`.changebtn`, `.sbtn` if used) the hover/press transition from Global Constraints. **Do not add** the Harvest chime / Auto-replant failed crops / Start with the season rows (Global Constraints).

- [ ] **Step 2: Verify manually**

Run: `cargo tauri dev`, open Settings. Expected: the four real fields (folder, max concurrent, speed limit, yt-dlp update) all still read/write exactly as before, now restyled; no toggle switches for the three unbacked settings appear anywhere in the panel; Save/Cancel behavior is unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/index.html src/styles.css src/app.js
git commit -m "feat: restyle the Settings panel"
```

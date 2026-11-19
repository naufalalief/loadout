# LOADOUT Main Window — Visual Redesign Implementation Design

**Spec for implementing the "LOADOUT FARM LOG" pixel / Harvest-Moon redesign into the real
app's main window** — `src/index.html`, `src/styles.css`, `src/app.js` — plus the one
`src-tauri` config change the window-chrome decision requires. The design itself was already
fully worked out as a set of Claude Artifact "Design" mockups
(https://claude.ai/artifact/AHbrEYDF9CuB8DiTPeJEBV) over a long back-and-forth; this doc
freezes the mockups' final state into a single written reference so an implementer never
needs to re-open that artifact (its boards can be edited live and drift) or wait on the
session's local scratch files (ephemeral — cleared by routine cleanup/reboot).

## Intent and why

The real app's current UI (`src/index.html` + `src/styles.css` + `src/app.js`) is a plain
dark vanilla-JS interface with no visual identity. Across a long design-exploration session
the owner converged on a pixel-art, Harvest-Moon-PS1-nostalgia visual language ("LOADOUT FARM
LOG" — downloads are "crops", the queue is a "field", settings is the "Tool Shed", etc.) and
iterated it against direct feedback until it felt right. This plan ports that *already-decided*
visual design into the real, working app without changing any of its actual behavior.

## Scope boundary (my call — confirm before building)

This covers only the desktop app's single page (`src/`): the queue/list view, the empty
state, the Add Download panel, the Settings panel, and the two popovers (speed limit, pick-a-
size). The browser extension (`extension/options.html`, `extension/content.js`, and the new
"Browser Companion Setup Guide" mockup) is **out of scope** — a separate follow-up round, per
the owner's explicit "satu per satu" (one at a time) preference, confirmed earlier as "main
window first, extension later."

## Goals

- Visually match the final mockups (Appendices A–D below) pixel-for-pixel in spirit: same
  color tokens, same typography pairing, same copy/labels, same icon system, same
  interaction model (popovers instead of always-visible forms, single-line status+meta
  instead of a separate badge column).
- Preserve 100% of existing behavior: every `invoke()` call, the 1s polling loop, and every
  status-gated rule for which action buttons appear, stays functionally identical. Only the
  *rendering* changes.
- Ship a real, working frameless window with custom title-bar controls (minimize/maximize/
  close) that actually work, not just look like they do.

## Non-goals

- No backend/Rust command changes. No new Tauri commands.
- No new *settings* beyond what the backend already exposes today (see the Settings-panel
  note under Constraints — three toggle rows in the mockup do not correspond to any real
  backend field and are explicitly dropped, not faked).
- No build step / bundler. `app.js`'s existing header comment ("Plain JS, no framework, no
  build step") is a constraint to keep, not just an observation.
- Extension-side pages are a separate plan.

## Anti-goals

- Don't lose functionality while reskinning. If a reviewer can find one `invoke()` call, one
  status-gated button rule, or one polling behavior that changed, that's a regression, not a
  style choice.
- Don't introduce per-download or per-job visual states that don't map to a real backend
  status string.

## Constraints (exact values — copy verbatim, don't re-derive)

**Fonts.** Press Start 2P (chrome/labels/buttons) + VT323 (body/meta text) — **self-hosted
locally**, not loaded from Google Fonts at runtime (owner's explicit decision: offline
reliability over convenience). Download both families' `.woff2` files plus their OFL license
text, add them under a new `src/fonts/` directory, and reference them via local `@font-face`
rules in `styles.css` instead of the `<link rel="stylesheet" href="https://fonts.googleapis...">`
pattern the mockups use (that pattern is mockup-only scaffolding, never port it as-is).

**Color tokens** (from the mockups' shared `:root`):
`--sky:#7ec8e8; --wood:#c98f4e; --wood-dark:#8a5a28; --cream:#fff8ea; --ink:#3a2410;
--ink-dim:#8a6b42; --stamina:#ff8a3c; --rp:#4ab8e8; --berry:#e8503c; --leaf:#5aa83c;`
Row separator color: `#e8dab8`. Status bar background: `#b07f42`. Status-bar status is a
bevel tone, not a design-system variable — keep it as that literal hex, it was chosen as a
specific "subtle gradient" compromise during the design phase.

**Window chrome.** The real window currently uses native OS decorations (`tauri.conf.json`
has no `decorations` key, so it defaults to `true`). This must change to a **frameless
window with a real custom title bar**:
- Set `"decorations": false` on the `"main"` window entry in `src-tauri/tauri.conf.json`.
- Render the title bar in HTML (wood background, app icon + "LOADOUT FARM LOG" Press-Start
  wordmark, `_ □ X` buttons — see Appendix A) with `data-tauri-drag-region` on the bar itself
  so the window can still be dragged.
- Wire the three buttons to the *real* window API: minimize, toggle-maximize/restore, close.
  `withGlobalTauri: true` is already set in `tauri.conf.json`, so the window API is reachable
  through the global `window.__TAURI__` object — confirm the exact current-window accessor
  and method names against whatever `@tauri-apps/api` version ships with this project's Tauri
  (left to the builder, see below).
- Verify `src-tauri/capabilities/default.json`'s existing `"core:default"` permission set
  actually covers minimize/maximize/close/start-dragging for the current window. If it
  doesn't, add `"core:window:default"` explicitly to that file's `"permissions"` array.
- Window title (used by the OS taskbar/alt-tab, even though the native title bar itself is
  gone) should be updated from `"Download Manager"` to `"LOADOUT FARM LOG"` in the same
  `tauri.conf.json` window entry.

**Icon rendering.** A single shared `buildIcon(filled, pal)` helper — exact algorithm in
Appendix A's `<script>` block (auto-shades each icon by per-row min/max-x into hi/base/sh,
then auto-computes a 1px outline ring around the shape) — reused for every icon in the app:
app icon (pot+sprout — title bar + anywhere else the app's identity appears), ISO icon
(disc), ZIP icon (folded document + zipper stripe), MP4/video icon (film strip — reused
as-is for both HTTP video downloads and extract jobs; the "withered" row recolors it to
`var(--berry)` via a literal `fill` override on the same cell shape, not a new icon), wrench
icon (status-bar "Tool Shed" settings button — Appendix A's script has its exact cell data),
and seed icon (Add Download panel only — Appendix C has its exact cell data, a Manhattan-
distance diamond). Whether this helper lives inline in `app.js` or gets split into its own
`src/icons.js` loaded before it is left to the builder.

**Row layout and copy.** Appendix A is the literal source of truth for the queue row markup
and CSS. Key points to not miss:
- One meta line per row: `<status word, colored> — <size/speed, or an error message>`. No
  separate badge column.
- Action buttons are plain-outline (cream background, ink border, no color-block fills);
  color is used only as text/icon tint, never as a button's whole background, except the
  `.active` state (open popover trigger — solid ink background) which only ever applies to
  the open popover's own trigger button.
- Every button's text label matters and must be ported exactly: `REST`, `WORK`, `LIMIT`,
  `PULL`, `REPLANT`, `PICK ▾`, and a `✕` icon-only button (tinted `var(--berry)`, used for
  every Cancel action). These replace today's plain-English labels — see the mapping table
  below.

**Status → badge-word mapping.** Every backend status string the app already produces maps
to a badge word + color (word goes inline in the meta line, replacing today's raw
`${status}` interpolation):

| Download status (`download.status`) | Badge word | Color token |
|---|---|---|
| `Downloading` | WORKING | `--stamina` |
| `Paused` | RESTING | `--ink-dim` |
| `Queued` | WAITING | `--ink-dim` |
| `Completed` | SHIPPED | `--leaf` |
| `Failed` | WITHERED | `--berry` |
| `Canceled` | CANCELED | `--ink-dim` |

| Extract-job status (`job.status`) | Badge word | Color token |
|---|---|---|
| `Probing` | SCOUTING | `--wood-dark` |
| `Downloading` | WORKING | `--stamina` |
| `AwaitingFormatChoice` | AWAITING | `--rp` |
| `Completed` | SHIPPED | `--leaf` |
| `Failed` | WITHERED | `--berry` |
| `Canceled` | CANCELED | `--ink-dim` |

**Action-button label mapping** (same gating conditions as the current
`actionsForDownload`/`actionsForExtract` in `app.js` — only the *label*, icon, and the new
`LIMIT`/`PICK ▾` buttons change):

| Current label | New label | Notes |
|---|---|---|
| Pause | REST | plain button |
| Resume | WORK | plain button |
| Retry | REPLANT | plain button |
| Cancel | ✕ | icon-only, `.danger` (berry) |
| Remove | PULL | `.danger` only on the `Failed` row (matches the mockup); plain on `Completed` |

New, not a relabel: every row whose status is "limitable" under today's exact rule
(`!["Completed", "Canceled"].includes(status)`) additionally gets a `LIMIT` button that
toggles the speed-limit popover (Appendix D) — this *replaces* the always-visible
`.download-limit` input+button, not just re-skins it. Extract rows in
`AwaitingFormatChoice` get a `PICK ▾` button that toggles the pick-a-size popover (Appendix
D) *instead of* the current inline `<select>` + "Download" button; clicking a listed
resolution in the popover calls `choose_extract_format` directly (no separate confirm step —
one click picks and starts).

**Popovers.** Closed by default; opened by clicking their trigger button (`LIMIT` or
`PICK ▾`), not by hover. Positioned `position:absolute; top:100%; right:…` under the trigger,
inside a `position:relative` row. Appendix D has the exact markup/CSS, including a fix that
is **not optional**: the popover's `<input>` needs `min-width:0` (plus `flex-shrink:0` on its
sibling button) or the browser's default text-input intrinsic width overflows the ~190px
popover and visually pushes the button out past the border — this exact bug was hit and
fixed once already during the design phase.

**Empty state.** When the merged `items` list (`downloads` + `extractJobs`) is empty, render
Appendix B's layout (potslot icon, "NO CROPS PLANTED YET", one line of explanatory copy, a
"+ NEW CROP" button that opens the Add Download panel) in place of today's plain
`<p id="empty-state">No downloads yet.</p>`.

**Add Download / Settings panels.** Stay **inline toggle sections on the same page** — the
current `.panel.hidden` show/hide behavior — never separate Tauri windows (one app window =
one title bar). Restyle their *content* per Appendix C, **without** their own mockup title
bar (the real page only ever has the one custom title bar at the very top of `index.html`).

Settings-panel specifics: port the "Watering limit" field (maps to the existing
`default_speed_limit_bytes_per_sec` input, already wired to `get_settings`/`set_settings` —
restyle only) and the "Check for yt-dlp update" row (already wired to `check_ytdlp_update` —
restyle only). **Do not port the three toggle switches** shown in the mockup ("Harvest
chime", "Auto-replant failed crops", "Start with the season") — none of the three has a
corresponding field in the backend's `Settings` struct today, and this plan does not add new
backend settings. Leave them out of the real implementation entirely rather than rendering
inert/fake toggles. (Flagging this explicitly since it's a real, visible difference from the
mockup — confirm you're fine with dropping those three rows before this is built.)

**Animations.** Every interactive element gets the same press/hover micro-interaction
already finalized across every mockup board:
```css
transition: transform .08s ease, box-shadow .08s ease, filter .1s ease;
```
plus `:hover{filter:brightness(1.05–1.1)}` and `:active{transform:translate(Npx,Npx)
matching that element's own box-shadow depth; box-shadow:none}`. Progress-bar width
transitions over `.4s ease`. Exact per-element values are in the appendices' CSS — copy them
rather than re-deriving.

## Approaches considered

1. **CSS-only reskin on the current DOM** (`.download-row`, `.download-actions`, the
   always-visible `.download-limit` block, etc.) — just new classes/colors on the existing
   skeleton. **Rejected.** This was effectively tried during the design-exploration phase (new
   colors/fonts on the old badge-column-plus-always-visible-forms layout) and the owner
   called the result "too busy" / "rame" even after several color/spacing iterations. The fix
   that actually worked was structural — collapsing the badge column into the meta line and
   hiding the limit/format controls behind popovers — not cosmetic.
2. **Full `app.js`/DOM restructuring to match the mockup's interaction model** (chosen).
   `createRow`/`updateRow`/`actionsFor*` get rewritten to build the new row shape and the new
   popover toggle behavior, while every `invoke()` call, the polling cadence, and every
   status-gated availability rule stays logically identical to today — only *what gets
   rendered* changes, never *what data drives it*.

## What's decided vs. left to the builder

**Decided (exact, don't re-derive):** every color token, the full status→word→color mapping,
the full button-label mapping, which Settings rows have a real backend field vs. are dropped,
which font families to bundle and why (self-hosted, not CDN), the window-chrome approach
(frameless + custom controls) and why, the popover behavior and its required `min-width:0`
fix, the animation timing values.

**Left to the builder:** exact popover pixel offsets (match the mockup's *proportions*, not
its literal px, since the real app's content width differs slightly from the mockups' 600px
`.wrap`); whether `buildIcon` lives inline in `app.js` or in its own `src/icons.js`; the exact
Tauri window-control API call names/import path for whichever `@tauri-apps/api`/Tauri version
this project actually has (confirm against `src-tauri/Cargo.toml`); minor CSS cleanup that
doesn't change anything listed above as decided.

---

## Appendix A — `Hearth.dc.html` (title bar, queue rows, status bar) — authoritative

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>LOADOUT FARM LOG</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
  :root{
    --sky:#7ec8e8; --cloud:#fff; --wood:#c98f4e; --wood-dark:#8a5a28;
    --cream:#fff8ea; --ink:#3a2410; --ink-dim:#8a6b42;
    --stamina:#ff8a3c; --rp:#4ab8e8; --sun:#ffd23c; --berry:#e8503c; --leaf:#5aa83c;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--sky);font-family:'VT323',monospace;font-size:16px;color:var(--ink);}
  .press{font-family:'Press Start 2P',monospace;}

  .wrap{position:relative;width:100%;max-width:600px;}
  .addrow{display:flex;align-items:center;justify-content:center;gap:8px;margin:10px 8px 2px;
    border:3px solid var(--ink);padding:11px;cursor:pointer;background:var(--leaf);
    box-shadow:3px 3px 0 0 var(--ink);transition:transform .08s ease,box-shadow .08s ease,filter .1s ease;}
  .addrow:hover{filter:brightness(1.05);}
  .addrow:active{transform:translate(3px,3px);box-shadow:none;}
  .addrow .label{font-family:'Press Start 2P';font-size:10px;color:#fff6e0;}

  .win{background:var(--cream);border:4px solid var(--ink);box-shadow:6px 6px 0 0 var(--ink);}

  .titlebar{background:var(--wood);
    display:flex;align-items:center;justify-content:space-between;padding:11px 12px 11px 16px;
    border-bottom:4px solid var(--ink);}
  .titlebar .tgroup{display:flex;align-items:center;gap:9px;}
  .titlebar .appicon{image-rendering:pixelated;flex-shrink:0;}
  .titlebar .t{font-size:12px;color:#fff6e0;letter-spacing:.5px;
    text-shadow:1px 0 var(--ink),-1px 0 var(--ink),0 1px var(--ink),0 -1px var(--ink);}
  .winbtns{display:flex;gap:6px;}
  .wb{width:18px;height:18px;background:var(--cream);border:2px solid var(--ink);color:var(--ink);
    display:flex;align-items:center;justify-content:center;font-size:9px;cursor:pointer;
    transition:transform .08s ease,filter .1s ease;}
  .wb:hover{filter:brightness(1.1);}
  .wb:active{transform:translate(1px,1px);}
  .wb.close{background:var(--berry);color:#fff6e0;}

  .content{padding:10px 6px 4px;}
  .row{display:flex;align-items:flex-start;gap:13px;padding:14px 10px;border-bottom:2px solid #e8dab8;}
  .row:last-child{border-bottom:none;}
  .slot{width:38px;height:38px;flex-shrink:0;background:#fff1d6;border:2px solid var(--ink-dim);
    display:flex;align-items:center;justify-content:center;}
  .sprite{image-rendering:pixelated;}
  .info{flex:1;min-width:0;}
  .fname{font-size:14px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .meta{font-size:13px;color:var(--ink-dim);margin-top:4px;}
  .meta .sword{font-family:'Press Start 2P';font-size:9px;letter-spacing:.5px;}
  .stambar-outer{margin-top:7px;height:11px;width:100%;max-width:190px;background:#fff;border:2px solid var(--ink);padding:1px;}
  .stambar-fill{height:100%;background:var(--stamina);transition:width .4s ease;}
  .actions{display:flex;gap:4px;flex-shrink:0;padding-top:1px;}
  .actbtn{min-width:26px;height:24px;padding:0 6px;background:#fff1d6;border:2px solid var(--ink);
    font-family:'Press Start 2P';font-size:8px;display:flex;align-items:center;justify-content:center;
    cursor:pointer;color:var(--ink);box-shadow:1px 1px 0 0 var(--ink);
    transition:transform .08s ease,box-shadow .08s ease,filter .1s ease;}
  .actbtn:hover{filter:brightness(1.08);}
  .actbtn:active{transform:translate(1px,1px);box-shadow:none;}
  .actbtn.danger{color:var(--berry);}
  .actbtn.active{background:var(--ink);color:var(--cream);}
  .statusbar{display:flex;align-items:center;gap:18px;padding:8px 10px 8px 16px;
    border-top:3px solid var(--ink);background:#b07f42;font-size:11px;color:#fff6e0;font-family:'Press Start 2P';}
  .statustext{display:flex;gap:16px;}
  .shedbtn{width:26px;height:26px;margin-left:auto;background:var(--wood);border:2px solid var(--ink);
    display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;
    transition:transform .08s ease,filter .1s ease;}
  .shedbtn:hover{filter:brightness(1.1);}
  .shedbtn:active{transform:translate(1px,1px);}
  .shedbtn .ticon{image-rendering:pixelated;}
</style>
</helmet>

<div class="wrap">
  <div class="win">
    <div class="titlebar">
      <div class="tgroup">
        <svg class="appicon" width="20" height="20" viewBox="0 0 12 12" shape-rendering="crispEdges">
          <sc-for list="{{appCells}}" as="c"><rect x="{{c.x}}" y="{{c.y}}" width="1" height="1" fill="{{c.fill}}"/></sc-for>
        </svg>
        <div class="t press">LOADOUT FARM LOG</div>
      </div>
      <div class="winbtns"><div class="wb">_</div><div class="wb">&#9633;</div><div class="wb close">X</div></div>
    </div>

    <div class="content">
      <div class="addrow"><span class="label press">+ NEW CROP</span></div>
      <div class="row">
        <div class="slot">
          <svg class="sprite" width="26" height="26" viewBox="0 0 12 12" shape-rendering="crispEdges">
            <sc-for list="{{discCells}}" as="c"><rect x="{{c.x}}" y="{{c.y}}" width="1" height="1" fill="{{c.fill}}"/></sc-for>
          </svg>
        </div>
        <div class="info">
          <div class="fname">ubuntu-24.04-desktop-amd64.iso</div>
          <div class="meta"><span class="sword" style="color:var(--stamina);">WORKING</span> &mdash; 812 MB of 1.3 GB &mdash; 4.2 MB/s</div>
          <div class="stambar-outer"><div class="stambar-fill" style="width:62%;"></div></div>
        </div>
        <div class="actions">
          <div class="actbtn">REST</div>
          <div class="actbtn">LIMIT</div>
          <div class="actbtn danger">&#10005;</div>
        </div>
      </div>

      <div class="row">
        <div class="slot">
          <svg class="sprite" width="26" height="26" viewBox="0 0 12 12" shape-rendering="crispEdges">
            <sc-for list="{{zipCells}}" as="c"><rect x="{{c.x}}" y="{{c.y}}" width="1" height="1" fill="{{c.fill}}"/></sc-for>
          </svg>
        </div>
        <div class="info">
          <div class="fname">design-assets-final-v3.zip</div>
          <div class="meta"><span class="sword" style="color:var(--ink-dim);">RESTING</span> &mdash; 140 MB of 500 MB</div>
          <div class="stambar-outer"><div class="stambar-fill" style="width:28%;background:var(--ink-dim);"></div></div>
        </div>
        <div class="actions">
          <div class="actbtn">WORK</div>
          <div class="actbtn">LIMIT</div>
          <div class="actbtn danger">&#10005;</div>
        </div>
      </div>

      <div class="row">
        <div class="slot">
          <svg class="sprite" width="26" height="26" viewBox="0 0 12 12" shape-rendering="crispEdges">
            <sc-for list="{{filmCells}}" as="c"><rect x="{{c.x}}" y="{{c.y}}" width="1" height="1" fill="{{c.fill}}"/></sc-for>
          </svg>
        </div>
        <div class="info">
          <div class="fname">conference-talk-2026.mp4</div>
          <div class="meta"><span class="sword" style="color:var(--leaf);">SHIPPED</span> &mdash; 1.1 GB</div>
        </div>
        <div class="actions">
          <div class="actbtn">PULL</div>
        </div>
      </div>

      <div class="row">
        <div class="slot">
          <svg class="sprite" width="26" height="26" viewBox="0 0 12 12" shape-rendering="crispEdges">
            <sc-for list="{{filmCells}}" as="c"><rect x="{{c.x}}" y="{{c.y}}" width="1" height="1" fill="var(--berry)"/></sc-for>
          </svg>
        </div>
        <div class="info">
          <div class="fname">podcast-episode-142.mp4</div>
          <div class="meta"><span class="sword" style="color:var(--berry);">WITHERED</span> <span style="color:var(--berry);">&mdash; lost the signal</span></div>
        </div>
        <div class="actions">
          <div class="actbtn">REPLANT</div>
          <div class="actbtn danger">PULL</div>
        </div>
      </div>

      <div class="row">
        <div class="slot">
          <svg class="sprite" width="26" height="26" viewBox="0 0 12 12" shape-rendering="crispEdges">
            <sc-for list="{{filmCells}}" as="c"><rect x="{{c.x}}" y="{{c.y}}" width="1" height="1" fill="{{c.fill}}"/></sc-for>
          </svg>
        </div>
        <div class="info">
          <div class="fname">funny-cat-compilation-2026</div>
          <div class="meta"><span class="sword" style="color:var(--rp);">AWAITING</span> &mdash; from video.site, pick a size to plant</div>
        </div>
        <div class="actions">
          <div class="actbtn">PICK &#9662;</div>
          <div class="actbtn danger">&#10005;</div>
        </div>
      </div>
    </div>

    <div class="statusbar">
      <div class="statustext">
        <span>5 TASKS</span>
        <span>2 WORKING</span>
      </div>
      <div class="shedbtn" title="Tool Shed (settings)">
        <svg class="ticon" width="17" height="17" viewBox="0 0 12 12" shape-rendering="crispEdges">
          <sc-for list="{{wrenchCells}}" as="c"><rect x="{{c.x}}" y="{{c.y}}" width="1" height="1" fill="{{c.fill}}"/></sc-for>
        </svg>
      </div>
    </div>
  </div>
</div>

</x-dc>
<script type="text/x-dc" data-dc-script>
class Component extends DCLogic {
  renderVals() {
    const GRID = 12;
    const OUTLINE = '#3a2410';

    function buildIcon(filled, pal) {
      const keys = Object.keys(filled);
      const filledSet = new Set(keys);
      const rowXs = {};
      keys.forEach(k => {
        if (filled[k] === true) {
          const [x, y] = k.split(',').map(Number);
          (rowXs[y] = rowXs[y] || []).push(x);
        }
      });
      Object.keys(rowXs).forEach(y => rowXs[y].sort((a, b) => a - b));
      const cells = [];
      keys.forEach(k => {
        const [x, y] = k.split(',').map(Number);
        let fill;
        if (filled[k] !== true) { fill = filled[k]; }
        else {
          const xs = rowXs[y];
          const minX = xs[0], maxX = xs[xs.length - 1];
          fill = x === minX ? pal.hi : (x === maxX ? pal.sh : pal.base);
        }
        cells.push({ x, y, fill });
      });
      const outline = new Set();
      keys.forEach(k => {
        const [x, y] = k.split(',').map(Number);
        [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].forEach(([nx, ny]) => {
          if (nx >= 0 && nx < GRID && ny >= 0 && ny < GRID) {
            const nk = nx + ',' + ny;
            if (!filledSet.has(nk)) outline.add(nk);
          }
        });
      });
      outline.forEach(k => {
        const [x, y] = k.split(',').map(Number);
        cells.push({ x, y, fill: OUTLINE });
      });
      return cells;
    }

    const discPal = { hi: '#eef3f8', base: '#9fb8cc', sh: '#5a7488' };
    const disc = {};
    const dcx = 5.5, dcy = 5.5, outerR = 5, innerR = 1.3;
    for (let x = 0; x <= 11; x++) for (let y = 0; y <= 11; y++) {
      const d = Math.hypot(x - dcx, y - dcy);
      if (d <= outerR && d >= innerR) disc[`${x},${y}`] = true;
    }
    const discCells = buildIcon(disc, discPal);

    const zipPal = { hi: '#ffe8b8', base: '#d9a050', sh: '#8a5a20' };
    const zip = {};
    for (let x = 2; x <= 9; x++) for (let y = 1; y <= 10; y++) {
      if (x >= 7 && y <= 3) continue;
      zip[`${x},${y}`] = true;
    }
    zip['6,1'] = '#8a5a20'; zip['6,2'] = '#8a5a20';
    const zipCells = buildIcon(zip, zipPal);
    [[5,3],[5,5],[5,7],[5,9],[4,4],[6,4],[4,6],[6,6],[4,8],[6,8]].forEach(([x,y]) => {
      zipCells.push({ x, y, fill: '#5c3a16' });
    });

    const filmPal = { hi: '#ffd6e8', base: '#e87ab0', sh: '#a8407a' };
    const film = {};
    [[6, 0, 5], [5, 1, 4], [7, 1, 4], [4, 2, 3], [8, 2, 3], [3, 3, 2], [9, 3, 2]].forEach(([y, left, w]) => {
      for (let x = left; x < left + w; x++) film[`${x},${y}`] = true;
    });
    const filmCells = buildIcon(film, filmPal);

    const potPal = { hi: '#e8a878', base: '#c9793e', sh: '#8a4f24' };
    const pot = {};
    for (let x = 3; x <= 8; x++) pot[`${x},${8}`] = true;
    for (let x = 3; x <= 8; x++) pot[`${x},${9}`] = true;
    for (let x = 4; x <= 7; x++) pot[`${x},${10}`] = true;
    const potCells = buildIcon(pot, potPal);

    const leafPal = { hi: '#b8e89a', base: '#5aa83c', sh: '#2f6b22' };
    const plant = {};
    for (let y = 4; y <= 7; y++) { plant[`5,${y}`] = true; plant[`6,${y}`] = true; }
    [[2,3],[3,2],[3,3],[4,2]].forEach(([x,y]) => plant[`${x},${y}`] = true);
    [[9,3],[8,2],[8,3],[7,2]].forEach(([x,y]) => plant[`${x},${y}`] = true);
    const plantCells = buildIcon(plant, leafPal);
    const appCells = potCells.concat(plantCells);

    const wrenchPal = { hi: '#e8e8ec', base: '#a8a8b8', sh: '#5c5c6c' };
    const wrench = {};
    [[2,9],[3,9],[3,8],[4,8],[4,7],[5,7],[5,6],[6,6],[6,5],[7,5]].forEach(([x,y]) => wrench[`${x},${y}`] = true);
    for (let x = 7; x <= 10; x++) for (let y = 1; y <= 4; y++) wrench[`${x},${y}`] = true;
    const wrenchCells = buildIcon(wrench, wrenchPal);

    return { discCells, zipCells, filmCells, appCells, wrenchCells };
  }
}
</script>
</body>
</html>
```

## Appendix B — `EmptyState.dc.html` (empty-state layout; pot icon has no plant — "empty pot")

```html
<style>
  .empty{display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:70px 30px;text-align:center;gap:16px;}
  .potslot{width:70px;height:70px;background:#fff1d6;border:2px solid var(--ink-dim);
    display:flex;align-items:center;justify-content:center;}
  .etitle{font-family:'Press Start 2P';font-size:13px;color:var(--ink);}
  .esub{font-size:15px;color:var(--ink-dim);max-width:340px;line-height:1.5;}
  .ebtn{margin-top:6px;font-family:'Press Start 2P';font-size:11px;color:#fff6e0;background:var(--leaf);
    border:2px solid var(--ink);padding:12px 20px;cursor:pointer;box-shadow:3px 3px 0 0 var(--ink);
    transition:transform .08s ease,box-shadow .08s ease,filter .1s ease;}
  .ebtn:hover{filter:brightness(1.05);}
  .ebtn:active{transform:translate(3px,3px);box-shadow:none;}
</style>

<div class="empty">
  <div class="potslot">
    <svg class="sprite" width="46" height="46" viewBox="0 0 12 12" shape-rendering="crispEdges">
      <sc-for list="{{potCells}}" as="c"><rect x="{{c.x}}" y="{{c.y}}" width="1" height="1" fill="{{c.fill}}"/></sc-for>
    </svg>
  </div>
  <div class="etitle">NO CROPS PLANTED YET</div>
  <div class="esub">Your field is empty. Paste a link and plant your first crop to start a download.</div>
  <div class="ebtn">+ NEW CROP</div>
</div>
```

Status bar for this state shows `0 TASKS` / `FIELD IS QUIET` instead of the normal counts.
The empty-pot icon (`potCells` here) is a *wider, plant-less* variant of the app icon's pot —
its own cell data (12×12 grid):
```js
const pot = {};
for (let x = 2; x <= 9; x++) pot[`${x},${7}`] = true;
for (let x = 2; x <= 9; x++) pot[`${x},${8}`] = true;
for (let x = 3; x <= 8; x++) pot[`${x},${9}`] = true;
for (let x = 4; x <= 7; x++) pot[`${x},${10}`] = true;
for (let x = 1; x <= 10; x++) pot[`${x},${6}`] = true;
// buildIcon(pot, { hi: '#e8a878', base: '#c9793e', sh: '#8a4f24' })
```

## Appendix C — Add Download panel content & Settings panel content

**Add Download** (`AddDownload.dc.html` body, minus its mockup title bar):
```html
<style>
  .hero{display:flex;align-items:center;gap:14px;padding:4px 2px 18px;}
  .heroslot{width:50px;height:50px;flex-shrink:0;background:#fff1d6;border:2px solid var(--ink-dim);
    display:flex;align-items:center;justify-content:center;}
  .herotext{font-size:13px;color:var(--ink-dim);line-height:1.5;}
  .field{margin-bottom:16px;}
  .field label{display:block;font-family:'Press Start 2P';font-size:9px;color:var(--ink);margin-bottom:7px;}
  .field input{width:100%;font-family:'VT323';font-size:16px;color:var(--ink);background:#fff;
    border:2px solid var(--ink);padding:9px 10px;box-shadow:inset 2px 2px 0 rgba(0,0,0,.06);
    transition:border-color .1s ease;}
  .field input::placeholder{color:var(--ink-dim);}
  .field input:focus{outline:none;border-color:var(--leaf);}
  .actions{display:flex;gap:10px;padding:8px 0 20px;}
  .btn{flex:1;font-family:'Press Start 2P';font-size:10px;padding:12px;cursor:pointer;
    border:2px solid var(--ink);box-shadow:3px 3px 0 0 var(--ink);text-align:center;
    transition:transform .08s ease,box-shadow .08s ease,filter .1s ease;}
  .btn:hover{filter:brightness(1.05);}
  .btn:active{transform:translate(3px,3px);box-shadow:none;}
  .btn.primary{background:var(--leaf);color:#fff6e0;}
  .btn.secondary{background:#fff1d6;color:var(--ink-dim);}
</style>

<div class="hero">
  <div class="heroslot">
    <svg class="sprite" width="34" height="34" viewBox="0 0 12 12" shape-rendering="crispEdges">
      <sc-for list="{{seedCells}}" as="c"><rect x="{{c.x}}" y="{{c.y}}" width="1" height="1" fill="{{c.fill}}"/></sc-for>
    </svg>
  </div>
  <div class="herotext">Paste a link and we'll plant it in your field. It'll grow into a finished file.</div>
</div>

<div class="field">
  <label class="press">DOWNLOAD URL</label>
  <input id="add-url" type="text" placeholder="https://example.com/file.iso" />
</div>

<div class="field">
  <label class="press">SAVE TO FIELD</label>
  <input id="add-filename" type="text" placeholder="(optional) filename" />
</div>

<div class="actions">
  <div class="btn secondary" id="cancel-add-btn">CANCEL</div>
  <div class="btn primary" id="add-submit-btn">+ PLANT IT</div>
</div>
```
Seed icon cell data (12×12 grid, Manhattan-distance diamond):
```js
const seedPal = { hi: '#fff0b8', base: '#f0c24b', sh: '#a4791e' };
const seed = {};
const scx = 5.5, scy = 5.5;
for (let x = 1; x <= 10; x++) for (let y = 1; y <= 10; y++) {
  if (Math.abs(x - scx) + Math.abs(y - scy) * 0.7 <= 4.2) seed[`${x},${y}`] = true;
}
// buildIcon(seed, seedPal)
```
Note: the mockup's "SAVE TO FIELD" field shows a folder path — the real app's
`add-filename` input is an *optional filename*, not a folder path (the folder is a global
setting, not per-download). Keep the real field's actual meaning; only the *label copy* is
themed ("SAVE TO FIELD" reads fine for either, but the placeholder/behavior must match
today's `add-filename` semantics exactly, not the mockup's literal placeholder text).

**Settings** (`Settings.dc.html` body, minus its mockup title bar and minus the three
unbacked toggle rows — see Constraints above):
```html
<style>
  .srow{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 2px;
    border-bottom:2px dashed var(--ink-dim);}
  .srow:last-child{border-bottom:none;}
  .slabel{font-size:15px;color:var(--ink);}
  .ssub{font-size:12px;color:var(--ink-dim);margin-top:2px;}
  .stepper{display:flex;align-items:center;gap:6px;flex-shrink:0;}
  .sbtn{width:24px;height:24px;background:#fff1d6;border:2px solid var(--ink);font-family:'Press Start 2P';
    font-size:11px;display:flex;align-items:center;justify-content:center;cursor:pointer;
    transition:transform .08s ease,filter .1s ease;}
  .sbtn:hover{filter:brightness(1.08);}
  .sbtn:active{transform:translate(1px,1px);}
  .sval{width:28px;text-align:center;font-family:'Press Start 2P';font-size:11px;}
  .pathbox{display:flex;align-items:center;gap:8px;flex-shrink:0;}
  .pathtext{font-size:13px;color:var(--ink-dim);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .smallinput{width:120px;font-family:'VT323';font-size:14px;color:var(--ink);background:#fff;
    border:2px solid var(--ink-dim);padding:5px 8px;}
  .changebtn{font-family:'Press Start 2P';font-size:8px;background:#fff1d6;border:2px solid var(--ink);
    padding:7px 9px;cursor:pointer;box-shadow:2px 2px 0 0 var(--ink);
    transition:transform .08s ease,box-shadow .08s ease,filter .1s ease;}
  .changebtn:hover{filter:brightness(1.08);}
  .changebtn:active{transform:translate(2px,2px);box-shadow:none;}
  .about{display:flex;align-items:center;gap:12px;padding:18px 2px 4px;}
  .aboutslot{width:38px;height:38px;flex-shrink:0;background:#fff1d6;border:2px solid var(--ink-dim);
    display:flex;align-items:center;justify-content:center;}
  .aboutver{font-size:12px;color:var(--ink-dim);}
</style>

<div class="srow">
  <div><div class="slabel">Field folder</div><div class="ssub">Where finished crops are stored</div></div>
  <div class="pathbox"><span class="pathtext" id="settings-download-dir-text"></span><div class="changebtn" id="settings-download-dir-change">CHANGE</div></div>
</div>

<div class="srow">
  <div><div class="slabel">Crops growing at once</div><div class="ssub">Max simultaneous downloads</div></div>
  <div class="stepper"><div class="sbtn" id="settings-max-concurrent-minus">-</div><div class="sval" id="settings-max-concurrent-val"></div><div class="sbtn" id="settings-max-concurrent-plus">+</div></div>
</div>

<div class="srow">
  <div><div class="slabel">Watering limit</div><div class="ssub">Default speed limit, bytes/sec (0 = no limit)</div></div>
  <div class="pathbox"><input id="settings-speed-limit" type="text" class="smallinput" placeholder="No limit"></div>
</div>

<div class="srow">
  <div><div class="slabel">Harvest tools</div><div class="ssub" id="ytdlp-version-text"></div></div>
  <div class="changebtn" id="check-ytdlp-update-btn">CHECK FOR UPDATE</div>
</div>

<div class="about">
  <div class="aboutslot"><svg class="sprite" width="26" height="26" viewBox="0 0 12 12" shape-rendering="crispEdges">
    <sc-for list="{{appCells}}" as="c"><rect x="{{c.x}}" y="{{c.y}}" width="1" height="1" fill="{{c.fill}}"/></sc-for>
  </svg></div>
  <div class="aboutver">LOADOUT FARM LOG &mdash; v1.0</div>
</div>
```
IDs above are suggested, to match the existing `settings-download-dir`/`settings-max-
concurrent`/`settings-speed-limit`/`check-ytdlp-update-btn` elements' *behavior* (today's
`#settings-download-dir` is a plain text input the user edits directly, not a "CHANGE"
button + read-only path — the builder should keep today's actual interaction, either an
editable `.pathtext`-styled text input, or add a real folder-picker behind "CHANGE" only if
a Tauri dialog command already exists for it; don't invent a native file-picker command if
one doesn't already exist in `src-tauri/src/commands.rs`).

## Appendix D — Popovers (speed limit / pick-a-size), including the required CSS fix

```html
<style>
  .popover{position:absolute;top:100%;right:10px;margin-top:4px;z-index:20;background:var(--cream);
    border:3px solid var(--ink);box-shadow:4px 4px 0 0 var(--ink);padding:10px 12px;min-width:170px;}
  .popover .ptitle{font-family:'Press Start 2P';font-size:8px;color:var(--ink-dim);margin-bottom:9px;}
  .popover .prow{display:flex;align-items:center;gap:6px;}
  /* REQUIRED: without min-width:0 the input's default intrinsic width overflows the
     popover and visually pushes the SET button out past the border. Hit once already. */
  .popover input{flex:1;min-width:0;font-family:'VT323';font-size:14px;color:var(--ink);background:#fff;
    border:2px solid var(--ink-dim);padding:5px 7px;}
  .popover .prow .actbtn{flex-shrink:0;}
  .popover .pick{display:block;width:100%;text-align:left;font-family:'VT323';font-size:15px;color:var(--ink);
    padding:7px 9px;border:2px solid var(--ink-dim);background:#fff1d6;margin-bottom:6px;cursor:pointer;
    transition:background .1s ease,color .1s ease,transform .08s ease;}
  .popover .pick:last-child{margin-bottom:0;}
  .popover .pick:hover{background:var(--leaf);color:#fff6e0;}
  .popover .pick:active{transform:translate(1px,1px);}
</style>

<!-- Speed-limit popover (anchored under a row's LIMIT button) -->
<div class="popover">
  <div class="ptitle">SPEED LIMIT</div>
  <div class="prow">
    <input type="text" placeholder="no limit">
    <div class="actbtn">SET</div>
  </div>
</div>

<!-- Pick-a-size popover (anchored under an extract row's PICK ▾ button) -->
<div class="popover">
  <div class="ptitle">PICK A SIZE</div>
  <div class="pick">1080p &mdash; 340 MB</div>
  <div class="pick">720p &mdash; 180 MB</div>
  <div class="pick">480p &mdash; 90 MB</div>
</div>
```
Each `.pick` row's click handler calls `choose_extract_format` with that option's label
directly — there is no separate "confirm" step once a size is clicked.

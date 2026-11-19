# LOADOUT Extension + Icon Completeness — Implementation Design

**Spec for the second implementation round of the LOADOUT visual redesign** — the main window
(round 1, merged) is done; this round covers everything round 1 explicitly deferred: the browser
extension's two surfaces (hover-to-download button, options page), a new "Browser Companion Setup
Guide" popup in the main app, and finishing the per-file-type icon set the main window's row
rendering only partially wired up. The visual design for all of this was already fully decided as
Claude Artifact mockups over a long session; this doc freezes that decided design into a single
written reference (the live artifact and the session's scratch files are both not durable) and
adds the real implementation decisions round 1 didn't need (new Tauri commands, bundling the
extension as an installer resource).

## Intent and why

Round 1 reskinned the desktop app's main window and explicitly scoped out the browser extension
("satu per satu" — one at a time). The extension's two surfaces still look exactly as they did
before any of this work started: a plain dark "Download" button on hover, and an unstyled options
page (documented in `docs/current-state-reference.md` as "the single roughest part of the current
UI"). Separately, round 1's per-row icon logic only recognizes `.iso`/`.zip`, falling back to a
generic film icon for everything else — the mockup (`FileIcons.dc.html`) designed five more icon
types that were never ported into the real `src/icons.js`. Finally, the "Browser Companion Setup
Guide" mockup (a step-by-step "how to load the extension" walkthrough) has nowhere to live yet —
discussed and resolved below (Constraints → Where the guide lives).

## Goals

- Match the hover-to-download button and extension options page to their mockups
  (`HoverButton.dc.html`, `ExtensionOptions.dc.html`) exactly: same tokens, same copy, same
  interaction model (the auto-pairing simplification already decided earlier this session).
- Add a third popup to the main app — the Browser Companion Setup Guide — reusing the `.panel`/
  `.panel-card`/`.popup-titlebar` infrastructure round 1 already built, triggered from a new Tool
  Shed row. Its two action buttons ("OPEN PAGE", "OPEN FOLDER") must actually do something, not
  just look like buttons.
- Port the five remaining icon builders from `FileIcons.dc.html` into `src/icons.js` and extend the
  real per-row icon-selection logic to use them.

## Non-goals

- No change to the pairing protocol itself (trust-on-first-use, `/pair`, `/ping`, the handoff
  server) — this round only touches what the options page *shows*, never how pairing actually
  works.
- No change to `content.js`'s video-detection/SPA-navigation/click-time-URL-resolution logic — only
  the overlay button's visual presentation changes.
- No new icon *categories* beyond the five the mockup already designed (PDF, MP3/audio, PNG/JPG,
  DOC/TXT, EXE/APP) — this is finishing a designed-but-unported set, not designing new ones.
- Still no Chrome Web Store listing (per the earlier "manual load, guided" decision this round's
  setup guide exists to support) — the guide walks through `chrome://extensions` → Developer mode →
  Load unpacked, not a Web Store install.

## Constraints

**Fonts, tokens, animations:** identical to round 1's Global Constraints (self-hosted Press Start
2P/VT323, the same color tokens, the same hover/press micro-interaction pattern). Not repeated in
full here — see `docs/superpowers/plans/2026-11-16-loadout-main-window.md`'s Global Constraints
section, which still applies to every new element in this round.

**`content.js`'s overlay is CSS-isolated already.** It injects a closed shadow-DOM host — restyling
it carries zero risk of colliding with any host page's CSS, and vice versa. The two fonts need to
be loaded *inside* that shadow root (a `<style>` with `@font-face` pointing at the extension's own
bundled font files — see Where the guide lives below for why extension-side assets need their own
copy, not a shared path into `src/fonts/`).

**Extension options page has zero existing CSS** — everything in `extension/options.html` is
unstyled. This round adds a real stylesheet (`extension/options.css`) and restructures the HTML to
match `ExtensionOptions.dc.html`, while preserving every existing id and every existing behavior in
`extension/options.js` exactly (`checkAppRunning()`, `pair()`, `forgetPairing()`,
`refreshPairButton()`, the `chrome.storage.onChanged` listener). The **auto-pairing simplification**
already decided this session: replace the prominent "Pair"/"Paired" button with a quiet status
note ("Paired automatically — nothing to do here.") plus a small "Pair manually" fallback link —
`refreshPairButton()`'s actual logic (reading `dmToken`, toggling what's shown) stays, only what it
toggles changes shape.

**Where the guide lives (resolved):** the Browser Companion Setup Guide cannot live inside the
extension itself (a user can't see it before the extension is installed — the thing it's a guide
for). It's a third popup in the main app (`src/`), triggered by a new "Browser Companion" row in
Settings with a "SET UP" button. This means:
- Its two mockup buttons need **real Tauri commands**, not just styled `<div>`s:
  - **"OPEN PAGE"** opens `chrome://extensions` in the user's default browser. `chrome://` isn't a
    registered OS protocol handler the way `http://` is, so a generic "open this URL" OS call is
    not guaranteed to land on that exact page on every system — attempt it via
    `tauri-plugin-opener`'s `open_url`, and if it doesn't resolve reliably in manual testing,
    the fallback is to copy `chrome://extensions` to the clipboard instead and tell the user to
    paste it into their address bar (left to the builder to decide based on what actually works —
    see What's left to the builder).
  - **"OPEN FOLDER"** opens the installed extension's folder in the OS file manager, via
    `tauri-plugin-opener`'s `open_path` (or `reveal_item_in_dir`) pointed at that folder's real
    on-disk location in the *installed* app, not a dev-time relative path.
- The `extension/` folder must actually ship with the installer for "OPEN FOLDER" to have anything
  to point at. It is **not currently bundled** — `tauri.conf.json`'s `bundle` section has no
  `resources` entry. Add one (e.g. `"resources": { "../extension": "extension" }` — exact key
  depends on the installed Tauri version's resource-config schema, confirm against
  `src-tauri/Cargo.toml`'s `tauri`/`tauri-build` version) so the extension's files land in the
  installed app's resource directory, and resolve that real path at runtime via Tauri's path API
  (`app.path().resource_dir()` or equivalent) in the new Tauri command — never a hardcoded relative
  path that only works in `cargo tauri dev`.
- `tauri-plugin-opener` is not currently a dependency (checked `src-tauri/Cargo.toml` — absent).
  Add it, register it in `src-tauri/src/main.rs`, and add its permission(s) to
  `src-tauri/capabilities/default.json` (e.g. `"opener:default"` or the specific
  `allow-open-url`/`allow-open-path` permissions — confirm exact identifiers against the installed
  plugin version the same way round 1 had to for `core:window:*`).

**Icon completeness — exact mapping** (extends `src/app.js`'s existing `iconCellsForFilename`,
which today only recognizes `.iso`→disc and `.zip`→zip, else→film):

| Extension(s) | Icon |
|---|---|
| `.iso` | disc *(existing, unchanged)* |
| `.zip`, `.rar`, `.7z`, `.tar`, `.gz` | zip *(existing `.zip` case, widened)* |
| `.pdf` | pdf *(new)* |
| `.mp3`, `.wav`, `.flac`, `.ogg`, `.m4a` | audio *(new)* |
| `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.svg` | img *(new)* |
| `.doc`, `.docx`, `.txt`, `.rtf`, `.odt` | doc *(new)* |
| `.exe`, `.msi`, `.app`, `.dmg` | exe *(new)* |
| anything else, including all video extensions and every extract job | film *(existing, unchanged)* |

The five new icon cell-builders (`pdfCells`, `audioCells`, `imgCells`, `docCells`, `exeCells`) and
the shared `docShape()` helper they're built from are in spec Appendix D below, ported verbatim
from `FileIcons.dc.html` — copy-exactly reference material, not something to redesign, same as
round 1's `buildIcon`.

## Approaches considered

1. **Ship the extension's fonts as a shared path back into `src/fonts/`** — rejected. The
   extension and the main app are packaged and distributed completely separately (a Chrome
   extension loaded via "Load unpacked" vs. an NSIS-installed desktop app); there is no shared
   filesystem path between them at the user's install. The extension needs its **own** copy of
   both font files under `extension/fonts/`.
2. **Make "OPEN PAGE"/"OPEN FOLDER" literal `<a href>`-style links instead of real commands** —
   rejected for "OPEN FOLDER" (opening a local folder isn't something a `file://` link reliably
   does across OSes/security settings from inside a webview) and insufficient for "OPEN PAGE"
   (still needs the clipboard-fallback judgment call either way). Real Tauri commands, chosen.
3. **Build the three extension/app pieces (hover button, options page, setup guide) as three
   separate tasks vs. one combined pass** — chosen: three separate tasks (plus a fourth for icon
   completeness), mirroring round 1's granularity, since each is independently testable and they
   touch almost entirely disjoint files (content.js vs. options.html/js vs. src/index.html+app.js+
   src-tauri commands vs. icons.js+app.js).

## What's decided vs. left to the builder

**Decided:** every color token/font/animation constraint (inherited from round 1); the auto-pairing
UI simplification's exact copy; the icon extension-to-icon mapping table above; that the setup guide
is a main-app popup, not extension-side; that `tauri-plugin-opener` is the mechanism for both
action buttons; that the extension needs its own bundled font copies.

**Left to the builder:** the exact `tauri.conf.json` `resources` key syntax for the installed Tauri
version; whether "OPEN PAGE" ends up as a direct `open_url("chrome://extensions")` call or the
clipboard-copy fallback, decided by actually testing which one reliably works; the exact
`tauri-plugin-opener` permission identifier(s) needed (same kind of verification round 1 had to do
for `core:window:*`); minor copy/wording not pinned by the mockups.

---

## Appendix A — `HoverButton.dc.html` (hover-to-download overlay button) — authoritative

```html
<style>
  :root{ --wood:#c98f4e; --cream:#fff8ea; --ink:#3a2410; --ink-dim:#8a6b42; --leaf:#5aa83c; }
  @keyframes popin{from{transform:scale(.8);opacity:0;}to{transform:scale(1);opacity:1;}}
  .pill{position:absolute;top:12px;right:12px;display:flex;align-items:center;gap:8px;
    background:var(--cream);border:2px solid var(--ink);padding:8px 12px;box-shadow:3px 3px 0 0 var(--ink);
    cursor:pointer;animation:popin .18s steps(4) both;
    transition:transform .1s ease,box-shadow .08s ease,filter .1s ease;}
  .pill:hover{filter:brightness(1.05);}
  .pill:active{transform:translate(2px,2px);box-shadow:none;}
  .pill .sprite{image-rendering:pixelated;flex-shrink:0;}
  .pill .label{font-family:'Press Start 2P';font-size:9px;color:var(--ink);}
</style>

<div class="pill">
  <svg class="sprite" width="16" height="16" viewBox="0 0 12 12" shape-rendering="crispEdges">
    <!-- appCells, same pot+sprout app icon used everywhere else -->
  </svg>
  <span class="label">HARVEST</span>
</div>
```

Notes for the real port into `extension/content.js`:
- The current overlay is injected into a **closed shadow DOM** (`host.attachShadow({mode:'closed'})`)
  with its own `<style>` text assigned via `style.textContent`. Keep that structure exactly; just
  change the injected CSS to the above (plus the two `@font-face` rules pointing at
  `extension/fonts/...`, loaded via a path relative to the content script — use
  `chrome.runtime.getURL('fonts/press-start-2p/PressStart2P-Regular.ttf')` style resolution, since a
  content script's relative CSS `url()` won't resolve against the host page's origin).
- Button text changes from `'Download'` to `'HARVEST'`; `resetButtonLabel()`'s hardcoded `'Download'`
  string becomes `'HARVEST'` (and the transient `'Sending…'`/`'Sent'`/`'Failed'` states stay as
  plain text, unstyled beyond what the pill's font already gives them — the mockup doesn't show
  those transient states, so match their existing English wording, just rendered through the new
  pill chrome).
- The app-icon `<svg>` needs the same `buildIcon`-generated `appCells` data `src/icons.js` already
  has — duplicate that literal cell data into a small inline builder inside `content.js` (content
  scripts can't `import` from the main app's `src/`; there is no shared module boundary between the
  two packages), or inline the already-computed cell array as a plain JS literal (simpler, since the
  app icon never changes — no need to re-run `buildIcon` at runtime for one static icon render).

## Appendix B — `ExtensionOptions.dc.html` (options page) — authoritative

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>LOADOUT — Extension Options</title>
</head>
<body>
<style>
  :root{
    --sky:#7ec8e8; --wood:#c98f4e; --wood-dark:#8a5a28;
    --cream:#fff8ea; --ink:#3a2410; --ink-dim:#8a6b42; --leaf:#5aa83c; --berry:#e8503c;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--sky);font-family:'VT323',monospace;font-size:16px;color:var(--ink);
    background-image:radial-gradient(circle at 12% 10%, #fff 0 20px, transparent 21px),
      radial-gradient(circle at 88% 8%, #fff 0 18px, transparent 19px);}
  .press{font-family:'Press Start 2P',monospace;}
  .page{max-width:560px;margin:0 auto;padding:50px 24px;}

  .header{display:flex;align-items:center;gap:14px;margin-bottom:28px;}
  .headicon{width:48px;height:48px;flex-shrink:0;background:var(--cream);border:3px solid var(--ink);
    display:flex;align-items:center;justify-content:center;box-shadow:3px 3px 0 0 var(--ink);}
  .sprite{image-rendering:pixelated;}
  .htitle{font-family:'Press Start 2P';font-size:16px;color:var(--ink);}
  .htag{font-size:14px;color:var(--ink-dim);margin-top:4px;}

  .card{background:var(--cream);border:3px solid var(--ink);box-shadow:5px 5px 0 0 var(--ink);
    padding:20px 22px;margin-bottom:20px;}

  .statusrow{display:flex;align-items:center;gap:10px;margin-bottom:16px;}
  @keyframes blink{0%,49%{opacity:1;}50%,100%{opacity:.4;}}
  .statusdot{width:12px;height:12px;background:var(--leaf);box-shadow:0 0 0 2px var(--ink);flex-shrink:0;
    animation:blink 1.6s steps(1) infinite;}
  .statustext{font-family:'Press Start 2P';font-size:11px;color:var(--leaf);}
  .statustext.off{color:var(--berry);}

  .pairnote{font-size:13px;color:var(--ink-dim);}
  .pairlink{font-size:13px;color:var(--ink);text-decoration:underline;cursor:pointer;margin-left:6px;
    transition:color .1s ease;}
  .pairlink:hover{color:var(--leaf);}

  .note{font-size:14px;color:var(--ink-dim);line-height:1.6;margin-bottom:16px;}
  .actrow{display:flex;gap:10px;flex-wrap:wrap;}
  .pairbtn2{font-family:'Press Start 2P';font-size:10px;color:var(--ink);background:#fff1d6;
    border:2px solid var(--ink);padding:10px 16px;cursor:pointer;box-shadow:2px 2px 0 0 var(--ink);
    transition:transform .08s ease,box-shadow .08s ease,filter .1s ease;}
  .pairbtn2:hover{filter:brightness(1.08);}
  .pairbtn2:active{transform:translate(2px,2px);box-shadow:none;}
  .forgetbtn{font-family:'Press Start 2P';font-size:10px;color:#fff6e0;background:var(--berry);
    border:2px solid var(--ink);padding:10px 16px;cursor:pointer;box-shadow:2px 2px 0 0 var(--ink);
    transition:transform .08s ease,box-shadow .08s ease,filter .1s ease;}
  .forgetbtn:hover{filter:brightness(1.08);}
  .forgetbtn:active{transform:translate(2px,2px);box-shadow:none;}
</style>

<div class="page">
  <div class="header">
    <div class="headicon">
      <svg class="sprite" width="34" height="34" viewBox="0 0 12 12" shape-rendering="crispEdges">
        <!-- appCells -->
      </svg>
    </div>
    <div>
      <div class="htitle">LOADOUT</div>
      <div class="htag">Browser Companion</div>
    </div>
  </div>

  <div class="card">
    <div class="statusrow">
      <div class="statusdot"></div>
      <div class="statustext">FIELD CONNECTED</div>
    </div>
  </div>

  <div class="card">
    <div class="note">
      Pairing happens automatically the first time you download or extract
      something. If it hasn't connected, or this extension was moved or
      reinstalled and the app still thinks the old install is paired, use
      these:
    </div>
    <div class="actrow">
      <div class="pairbtn2">PAIR MANUALLY</div>
      <div class="forgetbtn">FORGET PAIRING</div>
    </div>
  </div>
</div>
</body>
</html>
```

Mapping onto the real `extension/options.js` logic (don't change any of this logic, only what HTML/
CSS it drives):
- `.statustext`'s text/color is driven by the existing `checkAppRunning()` result: `'FIELD CONNECTED'`
  / `--leaf` when running, `'FIELD NOT CONNECTED'` (or similar — pick clear wording, the mockup only
  shows the connected state) / `.off`/`--berry` when not. The blink animation runs regardless of
  state (an ambient "live" cue), not just when connected.
- `PAIR MANUALLY` button's click handler is the existing `pair()` function and its error handling
  (`errorEl.textContent = result.error`) — same behavior, just under the new button/classes. Per the
  already-decided auto-pairing simplification, this button is de-emphasized (`.pairbtn2`, not a loud
  primary action) since the common case needs no manual step.
- `FORGET PAIRING` → existing `forgetPairing()` + `forgetStatusEl` messaging, re-themed.
- The existing `refreshPairButton()` function's *reads* (checking `dmToken` in storage) stay; its
  *writes* (what it shows) change from toggling a "Pair"/"Paired" button's text/disabled state to
  whatever the new layout needs (e.g. toggling a small inline confirmation near the status card when
  freshly auto-paired) — exact micro-copy for that confirmation moment isn't pinned by the mockup,
  left to the builder.

## Appendix C — `BrowserSetup.dc.html` (new popup: Browser Companion Setup Guide) — authoritative

```html
<style>
  :root{
    --sky:#7ec8e8; --wood:#c98f4e; --cream:#fff8ea; --ink:#3a2410; --ink-dim:#8a6b42;
    --leaf:#5aa83c; --berry:#e8503c;
  }
  .intro{font-size:14px;color:var(--ink-dim);line-height:1.6;margin-bottom:6px;}
  .intro b{color:var(--ink);}

  .step{display:flex;gap:14px;padding:15px 2px;border-bottom:2px solid #e8dab8;}
  .step:last-of-type{border-bottom:none;}
  .stepnum{width:28px;height:28px;flex-shrink:0;background:var(--leaf);color:#fff6e0;border:2px solid var(--ink);
    display:flex;align-items:center;justify-content:center;font-family:'Press Start 2P';font-size:12px;
    box-shadow:2px 2px 0 0 var(--ink);}
  .steptext{flex:1;padding-top:2px;}
  .stitle{font-size:15px;color:var(--ink);}
  .shint{font-size:12px;color:var(--ink-dim);margin-top:3px;}
  .stepbtn{display:inline-flex;margin-top:9px;font-family:'Press Start 2P';font-size:8px;color:var(--ink);
    background:#fff1d6;border:2px solid var(--ink);padding:7px 10px;cursor:pointer;
    box-shadow:2px 2px 0 0 var(--ink);transition:transform .08s ease,box-shadow .08s ease,filter .1s ease;}
  .stepbtn:hover{filter:brightness(1.08);}
  .stepbtn:active{transform:translate(2px,2px);box-shadow:none;}

  .tip{display:flex;gap:10px;align-items:flex-start;margin:4px 2px 18px;padding:11px 12px;
    background:#fff1d6;border:2px dashed var(--ink-dim);}
  .tip .glyph{font-size:15px;line-height:1;}
  .tip .ttext{font-size:13px;color:var(--ink-dim);line-height:1.5;}

  .actions{display:flex;gap:10px;padding:4px 0 20px;}
  .btn{flex:1;font-family:'Press Start 2P';font-size:10px;padding:12px;cursor:pointer;
    border:2px solid var(--ink);box-shadow:3px 3px 0 0 var(--ink);text-align:center;
    transition:transform .08s ease,box-shadow .08s ease,filter .1s ease;}
  .btn:hover{filter:brightness(1.05);}
  .btn:active{transform:translate(3px,3px);box-shadow:none;}
  .btn.primary{background:var(--leaf);color:#fff6e0;}
  .btn.secondary{background:#fff1d6;color:var(--ink-dim);}
</style>

<div class="intro">The Browser Companion adds a <b>Harvest</b> button when you hover a video, and sends links
straight to your field. It's a one-time, 1-minute setup -- you won't need to do this again.</div>

<div class="step">
  <div class="stepnum">1</div>
  <div class="steptext">
    <div class="stitle">Open your browser's extensions page</div>
    <div class="shint">chrome://extensions</div>
    <div class="stepbtn" id="setup-open-page-btn">OPEN PAGE</div>
  </div>
</div>

<div class="step">
  <div class="stepnum">2</div>
  <div class="steptext">
    <div class="stitle">Turn on Developer mode</div>
    <div class="shint">Toggle switch, top-right corner of that page</div>
  </div>
</div>

<div class="step">
  <div class="stepnum">3</div>
  <div class="steptext">
    <div class="stitle">Open the companion's folder</div>
    <div class="shint">Where it lives on your computer</div>
    <div class="stepbtn" id="setup-open-folder-btn">OPEN FOLDER</div>
  </div>
</div>

<div class="step">
  <div class="stitle">Click "Load unpacked", then pick that folder</div>
  <div class="shint">The companion will show up in your extensions list, ready to go</div>
</div>

<div class="tip">
  <div class="glyph">&#128204;</div>
  <div class="ttext">Tip: pin it to your toolbar (the puzzle-piece icon in Chrome) so the Harvest button is always one click away.</div>
</div>

<div class="actions">
  <div class="btn secondary">SKIP FOR NOW</div>
  <div class="btn primary">&#10003; I'VE INSTALLED IT</div>
</div>
```

Real wiring, on top of round 1's `.panel`/`.panel-card`/`.popup-titlebar` infrastructure:
- New Settings row: label "Browser Companion", sub "Set up the extension's hover-to-download button",
  a `.changebtn`-styled "SET UP" button that opens this as a new popup (same `openPanel`/`closePanel`
  pattern as the other two).
- Popup title bar: "BROWSER COMPANION SETUP" + close X, same `.popup-titlebar` pattern, own app icon.
- `#setup-open-page-btn` → new Tauri command (see Constraints → Where the guide lives) attempting
  `open_url("chrome://extensions")`; `#setup-open-folder-btn` → new Tauri command resolving the
  bundled extension resource directory and opening it.
- `SKIP FOR NOW` / `✓ I'VE INSTALLED IT` both just close the popup (`closePanel`) — this round adds no
  new persisted state tracking "has the user set up the extension"; both buttons are equivalent
  dismiss actions for now (a `has_seen_extension_setup`-style persisted flag is explicitly out of
  scope — nothing asked for it, and the plan's own "don't invent backend fields nothing asked for"
  precedent from round 1's Settings toggles applies here too).

## Appendix D — Five remaining icon builders, ported verbatim from `FileIcons.dc.html`

```js
function docShape() {
  const doc = {};
  for (let x = 2; x <= 9; x++) for (let y = 1; y <= 10; y++) {
    if (x >= 7 && y <= 3) continue;
    doc[`${x},${y}`] = true;
  }
  return doc;
}

const pdfPal = { hi: '#ffd6cc', base: '#e8795c', sh: '#a4402a' };
const pdf = docShape();
pdf['6,1'] = '#a4402a'; pdf['6,2'] = '#a4402a';
const pdfCells = buildIcon(pdf, pdfPal);
for (let x = 2; x <= 9; x++) for (let y = 8; y <= 9; y++) {
  pdfCells.push({ x, y, fill: '#c0392b' });
}

const audioPal = { hi: '#d6f0e8', base: '#6ab89c', sh: '#2f7a60' };
const audio = docShape();
audio['6,1'] = '#2f7a60'; audio['6,2'] = '#2f7a60';
const audioCells = buildIcon(audio, audioPal);
[[6,5],[6,6],[6,7],[7,4],[7,5]].forEach(([x,y]) => audioCells.push({ x, y, fill: '#1a4a38' }));
for (let x = 4; x <= 6; x++) for (let y = 8; y <= 9; y++) audioCells.push({ x, y, fill: '#1a4a38' });

const imgPal = { hi: '#dff0ff', base: '#7ab8e0', sh: '#3a6f98' };
const img = docShape();
img['6,1'] = '#3a6f98'; img['6,2'] = '#3a6f98';
const imgCells = buildIcon(img, imgPal);
for (let x = 3; x <= 4; x++) for (let y = 4; y <= 5; y++) imgCells.push({ x, y, fill: '#f0c24b' });
[[3,9],[4,8],[5,7],[6,8],[7,7],[8,8],[8,9],[3,8],[9,9]].forEach(([x,y]) => imgCells.push({ x, y, fill: '#4a8a5c' }));

const docPal = { hi: '#e8eef8', base: '#8fa0c0', sh: '#4a5a80' };
const docIcon = docShape();
docIcon['6,1'] = '#4a5a80'; docIcon['6,2'] = '#4a5a80';
const docCells = buildIcon(docIcon, docPal);
[5,6,7,8].forEach(y => { for (let x = 3; x <= 8; x++) docCells.push({ x, y, fill: '#3a2410' }); });

const exePal = { hi: '#e0dced', base: '#9b8ec4', sh: '#5a4a88' };
const exe = {};
for (let x = 2; x <= 9; x++) for (let y = 1; y <= 7; y++) exe[`${x},${y}`] = true;
for (let x = 5; x <= 6; x++) exe[`${x},${8}`] = true;
for (let x = 3; x <= 8; x++) exe[`${x},${9}`] = true;
const exeCells = buildIcon(exe, exePal);
```

`buildIcon` and `GRID`/`OUTLINE` are already in `src/icons.js` (round 1, Task 2) — these five
builders call that same existing `buildIcon`, they don't need their own copy of it. Export all five
(`pdfCells`, `audioCells`, `imgCells`, `docCells`, `exeCells`) alongside `icons.js`'s existing
exports.

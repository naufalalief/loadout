// Shared pixel-grid icon generator for Loadout.
//
// Icons are still drawn as colored cells on a 12x12 grid (the renderer in
// app.js -- `renderIconInto` -- just paints 1x1 <rect>s, nothing about that
// mechanism is tied to any particular visual style), but the shapes and
// palettes below were redrawn for the minimalist pass: every icon is a
// single flat tone (no hi/base/sh bevel) instead of the old pixel-art
// shading, the farm-specific shapes (a plant pot, a seed) were replaced
// with neutral equivalents (a download arrow, an open tray), and the
// outline ring uses the new ink color.

const GRID = 12;
const OUTLINE = '#1b1f24';

// Turns a { "x,y": true | "#hex" } map into 12x12 cells with per-row
// auto-shading (leftmost = hi, rightmost = sh, others = base) and a 1px
// outline ring around the shape. Pass the same color for `hi`/`base`/`sh`
// for a flat icon with no bevel, which is what every icon below does.
export function buildIcon(filled, pal) {
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

// Builds a flat (no-bevel) icon: `buildIcon` with hi/base/sh all equal.
function flatIcon(filled, color) {
  return buildIcon(filled, { hi: color, base: color, sh: color });
}

// ISO disc icon: a ring.
const disc = {};
const dcx = 5.5, dcy = 5.5, outerR = 5, innerR = 1.3;
for (let x = 0; x <= 11; x++) for (let y = 0; y <= 11; y++) {
  const d = Math.hypot(x - dcx, y - dcy);
  if (d <= outerR && d >= innerR) disc[`${x},${y}`] = true;
}
export const discCells = flatIcon(disc, '#94a3b8');

// ZIP icon: a zipper-tab block with a darker zipper line down the middle.
const zip = {};
for (let x = 2; x <= 9; x++) for (let y = 1; y <= 10; y++) {
  if (x >= 7 && y <= 3) continue;
  zip[`${x},${y}`] = true;
}
zip['6,1'] = '#8a6a30'; zip['6,2'] = '#8a6a30';
export const zipCells = flatIcon(zip, '#b58a46');
[[5,3],[5,5],[5,7],[5,9],[4,4],[6,4],[4,6],[6,6],[4,8],[6,8]].forEach(([x,y]) => {
  zipCells.push({ x, y, fill: '#8a6a30' });
});

// App icon / download mark: a down arrow dropping into an open tray.
// Replaces the previous pot-and-sprout mark -- same role (title bar,
// every popup's own mini title bar), neutral meaning instead of a farm
// metaphor.
function arrowIntoTray() {
  const shape = {};
  // Shaft
  for (let y = 1; y <= 4; y++) { shape[`5,${y}`] = true; shape[`6,${y}`] = true; }
  // Arrowhead, widening then converging to a point
  for (let x = 3; x <= 8; x++) shape[`${x},5`] = true;
  for (let x = 4; x <= 7; x++) shape[`${x},6`] = true;
  shape['5,7'] = true; shape['6,7'] = true;
  // Open tray underneath
  for (let x = 2; x <= 9; x++) shape[`${x},9`] = true;
  shape['2,8'] = true; shape['9,8'] = true;
  return shape;
}
export const appCells = flatIcon(arrowIntoTray(), '#2f6fed');

// Status-bar settings (wrench) icon -- a wrench is already a neutral,
// universal "settings" symbol, so only its palette changed (flat, not
// beveled).
const wrench = {};
[[2,9],[3,9],[3,8],[4,8],[4,7],[5,7],[5,6],[6,6],[6,5],[7,5]].forEach(([x,y]) => wrench[`${x},${y}`] = true);
for (let x = 7; x <= 10; x++) for (let y = 1; y <= 4; y++) wrench[`${x},${y}`] = true;
export const wrenchCells = flatIcon(wrench, '#6b7280');

// Empty-state icon: an open tray (no arrow) -- "nothing in here yet",
// in place of the previous empty plant pot.
const emptyTray = {};
for (let x = 2; x <= 9; x++) { emptyTray[`${x},9`] = true; }
for (let y = 4; y <= 9; y++) { emptyTray[`2,${y}`] = true; emptyTray[`9,${y}`] = true; }
export const emptyPotCells = flatIcon(emptyTray, '#9aa1ab');

// Add Download panel hero icon -- the same download-arrow mark as the app
// icon above (this popup's one job is adding a download), in place of the
// previous seed/diamond shape.
export const seedCells = flatIcon(arrowIntoTray(), '#2f6fed');

// Shared document-page silhouette: a page with a folded top-right corner.
// The PDF/audio/image/doc builders below all start from it.
export function docShape() {
  const doc = {};
  for (let x = 2; x <= 9; x++) for (let y = 1; y <= 10; y++) {
    if (x >= 7 && y <= 3) continue;
    doc[`${x},${y}`] = true;
  }
  return doc;
}

const pdf = docShape();
pdf['6,1'] = '#8a4a40'; pdf['6,2'] = '#8a4a40';
export const pdfCells = flatIcon(pdf, '#c0695a');
for (let x = 2; x <= 9; x++) for (let y = 8; y <= 9; y++) {
  pdfCells.push({ x, y, fill: '#8a4a40' });
}

const audio = docShape();
audio['6,1'] = '#2f6b58'; audio['6,2'] = '#2f6b58';
export const audioCells = flatIcon(audio, '#4fa88a');
[[6,5],[6,6],[6,7],[7,4],[7,5]].forEach(([x,y]) => audioCells.push({ x, y, fill: '#2f6b58' }));
for (let x = 4; x <= 6; x++) for (let y = 8; y <= 9; y++) audioCells.push({ x, y, fill: '#2f6b58' });

const img = docShape();
img['6,1'] = '#3f6690'; img['6,2'] = '#3f6690';
export const imgCells = flatIcon(img, '#5b8fc4');
for (let x = 3; x <= 4; x++) for (let y = 4; y <= 5; y++) imgCells.push({ x, y, fill: '#f0c24b' });
[[3,9],[4,8],[5,7],[6,8],[7,7],[8,8],[8,9],[3,8],[9,9]].forEach(([x,y]) => imgCells.push({ x, y, fill: '#3f6690' }));

const docIcon = docShape();
docIcon['6,1'] = '#5a6478'; docIcon['6,2'] = '#5a6478';
export const docCells = flatIcon(docIcon, '#8a93a6');
[5,6,7,8].forEach(y => { for (let x = 3; x <= 8; x++) docCells.push({ x, y, fill: '#5a6478' }); });

// MP4 / video icon: the same document-page silhouette, with a play-button
// triangle overlay. Extract jobs always use this one regardless of their
// real extension.
const film = docShape();
film['6,1'] = '#8a3a68'; film['6,2'] = '#8a3a68';
export const filmCells = flatIcon(film, '#c45b94');
[[5,4],[5,5],[6,5],[5,6],[6,6],[7,6],[5,7],[6,7],[5,8]].forEach(([x,y]) => {
  filmCells.push({ x, y, fill: '#8a3a68' });
});

const exe = {};
for (let x = 2; x <= 9; x++) for (let y = 1; y <= 7; y++) exe[`${x},${y}`] = true;
for (let x = 5; x <= 6; x++) exe[`${x},8`] = true;
for (let x = 3; x <= 8; x++) exe[`${x},9`] = true;
export const exeCells = flatIcon(exe, '#8b7cc4');

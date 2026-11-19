// Shared pixel-icon generator for the LOADOUT reskin.
// Algorithm and cell data ported verbatim from the design spec
// (Appendix A `buildIcon` + per-icon cell data, Appendix C seed data).

const GRID = 12;
const OUTLINE = '#3a2410';

// Turns a { "x,y": true | "#hex" } map into 12x12 cells with per-row
// auto-shading (leftmost = hi, rightmost = sh, others = base) and a 1px
// outline ring around the shape.
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

// ISO disc icon: a ring.
const discPal = { hi: '#eef3f8', base: '#9fb8cc', sh: '#5a7488' };
const disc = {};
const dcx = 5.5, dcy = 5.5, outerR = 5, innerR = 1.3;
for (let x = 0; x <= 11; x++) for (let y = 0; y <= 11; y++) {
  const d = Math.hypot(x - dcx, y - dcy);
  if (d <= outerR && d >= innerR) disc[`${x},${y}`] = true;
}
export const discCells = buildIcon(disc, discPal);

// ZIP icon: a zipper-tab block with dark teeth.
const zipPal = { hi: '#ffe8b8', base: '#d9a050', sh: '#8a5a20' };
const zip = {};
for (let x = 2; x <= 9; x++) for (let y = 1; y <= 10; y++) {
  if (x >= 7 && y <= 3) continue;
  zip[`${x},${y}`] = true;
}
zip['6,1'] = '#8a5a20'; zip['6,2'] = '#8a5a20';
export const zipCells = buildIcon(zip, zipPal);
[[5,3],[5,5],[5,7],[5,9],[4,4],[6,4],[4,6],[6,6],[4,8],[6,8]].forEach(([x,y]) => {
  zipCells.push({ x, y, fill: '#5c3a16' });
});

// App icon: pot + sprout (pot cells first, then plant cells).
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
export const appCells = potCells.concat(plantCells);

// Status-bar "Tool Shed" wrench icon.
const wrenchPal = { hi: '#e8e8ec', base: '#a8a8b8', sh: '#5c5c6c' };
const wrench = {};
[[2,9],[3,9],[3,8],[4,8],[4,7],[5,7],[5,6],[6,6],[6,5],[7,5]].forEach(([x,y]) => wrench[`${x},${y}`] = true);
for (let x = 7; x <= 10; x++) for (let y = 1; y <= 4; y++) wrench[`${x},${y}`] = true;
export const wrenchCells = buildIcon(wrench, wrenchPal);

// Empty-state "empty pot" icon: a wider, plant-less variant of the app
// icon's pot (spec Appendix B), used in place of `appCells` when the queue
// is empty.
const emptyPot = {};
for (let x = 2; x <= 9; x++) emptyPot[`${x},${7}`] = true;
for (let x = 2; x <= 9; x++) emptyPot[`${x},${8}`] = true;
for (let x = 3; x <= 8; x++) emptyPot[`${x},${9}`] = true;
for (let x = 4; x <= 7; x++) emptyPot[`${x},${10}`] = true;
for (let x = 1; x <= 10; x++) emptyPot[`${x},${6}`] = true;
export const emptyPotCells = buildIcon(emptyPot, { hi: '#e8a878', base: '#c9793e', sh: '#8a4f24' });

// Add Download panel seed icon (Manhattan-distance diamond).
const seedPal = { hi: '#fff0b8', base: '#f0c24b', sh: '#a4791e' };
const seed = {};
const scx = 5.5, scy = 5.5;
for (let x = 1; x <= 10; x++) for (let y = 1; y <= 10; y++) {
  if (Math.abs(x - scx) + Math.abs(y - scy) * 0.7 <= 4.2) seed[`${x},${y}`] = true;
}
export const seedCells = buildIcon(seed, seedPal);

// Shared document-page silhouette (spec Appendix D): a page with a folded
// top-right corner. The PDF/audio/image/doc builders below all start from it.
export function docShape() {
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
export const pdfCells = buildIcon(pdf, pdfPal);
for (let x = 2; x <= 9; x++) for (let y = 8; y <= 9; y++) {
  pdfCells.push({ x, y, fill: '#c0392b' });
}

const audioPal = { hi: '#d6f0e8', base: '#6ab89c', sh: '#2f7a60' };
const audio = docShape();
audio['6,1'] = '#2f7a60'; audio['6,2'] = '#2f7a60';
export const audioCells = buildIcon(audio, audioPal);
[[6,5],[6,6],[6,7],[7,4],[7,5]].forEach(([x,y]) => audioCells.push({ x, y, fill: '#1a4a38' }));
for (let x = 4; x <= 6; x++) for (let y = 8; y <= 9; y++) audioCells.push({ x, y, fill: '#1a4a38' });

const imgPal = { hi: '#dff0ff', base: '#7ab8e0', sh: '#3a6f98' };
const img = docShape();
img['6,1'] = '#3a6f98'; img['6,2'] = '#3a6f98';
export const imgCells = buildIcon(img, imgPal);
for (let x = 3; x <= 4; x++) for (let y = 4; y <= 5; y++) imgCells.push({ x, y, fill: '#f0c24b' });
[[3,9],[4,8],[5,7],[6,8],[7,7],[8,8],[8,9],[3,8],[9,9]].forEach(([x,y]) => imgCells.push({ x, y, fill: '#4a8a5c' }));

const docPal = { hi: '#e8eef8', base: '#8fa0c0', sh: '#4a5a80' };
const docIcon = docShape();
docIcon['6,1'] = '#4a5a80'; docIcon['6,2'] = '#4a5a80';
export const docCells = buildIcon(docIcon, docPal);
[5,6,7,8].forEach(y => { for (let x = 3; x <= 8; x++) docCells.push({ x, y, fill: '#3a2410' }); });

// MP4 / video icon: same document-page silhouette as pdf/audio/img/doc
// above, with a play-button triangle overlay -- was previously its own
// tiny (4 rows tall, vs. every other icon's 10) abstract wedge shape that
// read as an unrecognizable, mirrored-looking blob rather than a file icon.
const filmPal = { hi: '#ffd6e8', base: '#e87ab0', sh: '#a8407a' };
const film = docShape();
film['6,1'] = '#a8407a'; film['6,2'] = '#a8407a';
export const filmCells = buildIcon(film, filmPal);
[[5,4],[5,5],[6,5],[5,6],[6,6],[7,6],[5,7],[6,7],[5,8]].forEach(([x,y]) => {
  filmCells.push({ x, y, fill: '#5c1a3a' });
});

const exePal = { hi: '#e0dced', base: '#9b8ec4', sh: '#5a4a88' };
const exe = {};
for (let x = 2; x <= 9; x++) for (let y = 1; y <= 7; y++) exe[`${x},${y}`] = true;
for (let x = 5; x <= 6; x++) exe[`${x},${8}`] = true;
for (let x = 3; x <= 8; x++) exe[`${x},${9}`] = true;
export const exeCells = buildIcon(exe, exePal);

// Frontend for the download queue: polls `list_downloads` and renders rows,
// plus the Add Download and Settings forms. Plain JS, no framework, no
// build step -- `window.__TAURI__` is exposed because `withGlobalTauri` is
// enabled in `tauri.conf.json`.

// `appCells` is icons.js's already-built (buildIcon-processed) cell array
// for the app's pot+sprout icon -- `buildIcon` itself isn't needed here
// since this module only renders a pre-built icon, never constructs one.
import { appCells, wrenchCells, emptyPotCells, discCells, zipCells, filmCells, seedCells, pdfCells, audioCells, imgCells, docCells, exeCells } from "./icons.js";

const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

const POLL_INTERVAL_MS = 1000;

const queueListEl = document.getElementById("queue-list");
const emptyStateEl = document.getElementById("empty-state");

const addrowBtn = document.getElementById("addrow-btn");
const emptyAddBtn = document.getElementById("empty-add-btn");
const shedBtn = document.getElementById("shedbtn");
const shedIconEl = document.getElementById("shedbtn-icon");
const emptyPotIconEl = document.getElementById("empty-pot-icon");
const addSeedIconEl = document.getElementById("add-seed-icon");
const statusTasksEl = document.getElementById("status-tasks");
const statusWorkingEl = document.getElementById("status-working");

const addPanelEl = document.getElementById("add-panel");
const addFormEl = document.getElementById("add-form");
const addUrlEl = document.getElementById("add-url");
const addFilenameEl = document.getElementById("add-filename");
const addErrorEl = document.getElementById("add-error");

const settingsPanelEl = document.getElementById("settings-panel");
const settingsFormEl = document.getElementById("settings-form");
const settingsDownloadDirEl = document.getElementById("settings-download-dir");
const settingsBrowseDownloadDirEl = document.getElementById("settings-browse-download-dir");
const settingsMaxConcurrentEl = document.getElementById("settings-max-concurrent");
const settingsSpeedLimitEl = document.getElementById("settings-speed-limit");
const settingHarvestChimeEl = document.getElementById("setting-harvest-chime");
const settingAutoReplantEl = document.getElementById("setting-auto-replant");
const settingStartWithSeasonEl = document.getElementById("setting-start-with-season");
const settingsErrorEl = document.getElementById("settings-error");
const checkYtdlpUpdateBtn = document.getElementById("check-ytdlp-update-btn");
const ytdlpUpdateStatusEl = document.getElementById("ytdlp-update-status");
const settingsAboutIconEl = document.getElementById("settings-about-icon");
const allowNewPairingBtn = document.getElementById("allow-new-pairing-btn");
const allowPairingStatusEl = document.getElementById("allow-pairing-status");
const pairedProfilesListEl = document.getElementById("paired-profiles-list");
const pairedProfilesEmptyEl = document.getElementById("paired-profiles-empty");

const browserSetupBtn = document.getElementById("browser-setup-btn");
const browserSetupPanelEl = document.getElementById("browser-setup-panel");
const browserSetupErrorEl = document.getElementById("browser-setup-error");
const setupOpenPageBtn = document.getElementById("setup-open-page-btn");
const setupPageStatusEl = document.getElementById("setup-page-status");
const setupOpenFolderBtn = document.getElementById("setup-open-folder-btn");

// Clears `svgEl` and repopulates it with one 1x1 <rect> per cell, in the
// pixel-icon grid coordinate system `icons.js`'s `buildIcon` produces.
// Every icon rendered from here on (this task's status-bar wrench and
// empty-state pot, plus every per-row icon in Task 5) goes through this
// instead of re-implementing the <rect>-building loop. The title bar's own
// icon (Task 3) predates this helper and is left as its own inline loop.
function renderIconInto(svgEl, cells) {
  svgEl.replaceChildren(
    ...cells.map((c) => {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", c.x);
      rect.setAttribute("y", c.y);
      rect.setAttribute("width", "1");
      rect.setAttribute("height", "1");
      rect.setAttribute("fill", c.fill);
      return rect;
    }),
  );
}

function formatBytes(bytes) {
  if (bytes == null) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function progressPercent(download) {
  if (!download.total_bytes) return null;
  const pct = (download.downloaded_bytes / download.total_bytes) * 100;
  return Math.max(0, Math.min(100, pct));
}

/**
 * Live transfer speed for a row, in bytes/sec, estimated from the byte
 * delta between this call and the last one for this same row. Neither
 * Tauri command's response carries a speed number -- `downloaded_bytes`
 * is the only thing either side tracks -- so this is the only source for
 * the "-- 4.2 MB/s" segment the spec's mockup calls for (see the main
 * window design doc, Appendix: queue row meta line).
 *
 * `els` is the row's persistent per-id cache (`rowsById`), so the
 * previous sample survives across polls. Returns `null` when `active` is
 * false (nothing to measure a rate for) or on a row's very first active
 * sample (no earlier point yet to diff against) -- both cases clear the
 * stored sample too, so a row that stops and later restarts (retry,
 * resume) doesn't compute a speed from a stale pre-restart byte count.
 */
function liveSpeedBytesPerSec(els, downloadedBytes, active) {
  if (!active || downloadedBytes == null) {
    els.speedPrevBytes = null;
    els.speedPrevTime = null;
    els.speedLast = null;
    return null;
  }

  const now = Date.now();
  if (els.speedPrevTime != null) {
    const deltaSeconds = (now - els.speedPrevTime) / 1000;
    // A delta of 0 (two updates landing in the same millisecond) would
    // divide by zero -- keep whatever rate is already on record instead.
    if (deltaSeconds > 0) {
      const deltaBytes = Math.max(0, downloadedBytes - els.speedPrevBytes);
      els.speedLast = deltaBytes / deltaSeconds;
    }
  }

  els.speedPrevBytes = downloadedBytes;
  els.speedPrevTime = now;
  return els.speedLast ?? null;
}

/**
 * The row meta line's size segment: `<downloaded> of <total>` (or just
 * `<downloaded>` when the total isn't known yet), plus a ` -- <speed>/s`
 * suffix whenever a live speed is available. Matches the design spec's
 * mockup text exactly (e.g. "812 MB of 1.3 GB -- 4.2 MB/s").
 */
function sizeAndSpeedText(downloadedBytes, totalBytes, speedBytesPerSec) {
  const sizeText =
    totalBytes != null
      ? `${formatBytes(downloadedBytes)} of ${formatBytes(totalBytes)}`
      : formatBytes(downloadedBytes);
  return speedBytesPerSec != null ? `${sizeText} — ${formatBytes(speedBytesPerSec)}/s` : sizeText;
}

// Extract-job statuses that keep a live subprocess around and so can be
// canceled; `Failed` is the only one that can be retried.
const EXTRACT_CANCELABLE_STATUSES = ["Probing", "AwaitingFormatChoice", "Downloading"];

// Extract-job statuses the backend's `remove_extract_job` command accepts
// (mirrors `ExtractJobManager::remove`'s terminal-status check).
const EXTRACT_TERMINAL_STATUSES = ["Completed", "Failed", "Canceled"];

// Statuses (shared by downloads and extract jobs -- the strings happen to
// match exactly) that mean no further transfer will ever happen for this
// row, so the progress bar has nothing left to show. The mockup never
// shows a bar on a Completed/Failed/Canceled row; the live app kept
// showing one at whatever fill level the transfer last reached.
const TERMINAL_STATUSES = ["Completed", "Failed", "Canceled"];

// Parses a speed-limit input's value into what the backend expects:
// `null` for "no limit" (empty, 0, or anything non-numeric), else a
// positive integer number of bytes/sec. 0 deliberately means "no limit",
// never "stall forever".
//
// The value must be *entirely* digits -- `parseInt` alone silently parses
// a leading numeric prefix and ignores the rest (e.g. "2MB" -> 2,
// "1,000,000" -> 1), which would turn a typo'd limit into a near-zero
// throttle instead of being rejected. A non-digit value is treated as
// invalid the same way genuinely empty input is: no limit.
function parseSpeedLimit(raw) {
  const trimmed = String(raw ?? "").trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const value = parseInt(trimmed, 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

// Status -> [badge word, color token] mapping (spec Appendix A Constraints
// tables) -- the single meta line's `<span class="sword">` text/color comes
// from here, replacing today's raw `${status}` interpolation. Exact words
// and tokens, not open to rephrasing.
const DOWNLOAD_BADGE = {
  Downloading: ["Downloading", "var(--accent)"],
  Paused: ["Paused", "var(--ink-dim)"],
  Queued: ["Queued", "var(--ink-dim)"],
  Completed: ["Completed", "var(--success)"],
  Failed: ["Failed", "var(--danger)"],
  Canceled: ["Canceled", "var(--ink-dim)"],
};
const EXTRACT_BADGE = {
  Probing: ["Fetching info", "var(--ink-dim)"],
  Downloading: ["Downloading", "var(--accent)"],
  AwaitingFormatChoice: ["Choose a quality", "var(--warn)"],
  Completed: ["Completed", "var(--success)"],
  Failed: ["Failed", "var(--danger)"],
  Canceled: ["Canceled", "var(--ink-dim)"],
};

// Picks a row's per-file-type `.slot` icon from its filename's extension
// (case-insensitive). Extensions not in the table -- including no extension
// at all -- fall back to film. Every extract-job row always shows the film
// icon regardless of its eventual filename (see `updateExtractRow`, which
// calls `filmCells` directly instead of this).
// This is new selection logic: the real app's data model never branched on
// filename before this task, it just had nothing rendering an icon at all.
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
  // Own-property check, not `byExt[ext] ?? ...`: a name like "x.constructor"
  // would otherwise hit an inherited Object.prototype member and return a
  // function instead of a cell array.
  return Object.prototype.hasOwnProperty.call(byExt, ext) ? byExt[ext] : filmCells;
}

// Rows are kept alive across polls, keyed by download id, and only their
// contents are updated in place. Rebuilding the whole list every poll
// (as this used to) could destroy a button between mousedown and mouseup
// and silently lose the click, and would wipe a half-typed speed limit.
const rowsById = new Map();

function createRow(item) {
  const isExtract = item.kind === "extract";
  const svgNs = "http://www.w3.org/2000/svg";

  const row = document.createElement("div");
  row.className = "row";

  const slot = document.createElement("div");
  slot.className = "slot";
  const svgIcon = document.createElementNS(svgNs, "svg");
  svgIcon.setAttribute("class", "sprite");
  svgIcon.setAttribute("width", "26");
  svgIcon.setAttribute("height", "26");
  svgIcon.setAttribute("viewBox", "0 0 12 12");
  svgIcon.setAttribute("shape-rendering", "crispEdges");
  slot.appendChild(svgIcon);
  row.appendChild(slot);

  const info = document.createElement("div");
  info.className = "info";

  const fname = document.createElement("div");
  fname.className = "fname";
  info.appendChild(fname);

  // One meta line: a `.sword`-styled status badge followed by the
  // size/speed text (or, when the item has an error, the error text
  // instead -- both colored berry, see `updateDownloadRow`/
  // `updateExtractRow`). Two child spans updated in place so a poll never
  // has to rebuild this line's DOM, only its text/color.
  const meta = document.createElement("div");
  meta.className = "meta";
  const badge = document.createElement("span");
  badge.className = "sword";
  const metaRest = document.createElement("span");
  metaRest.className = "mrest";
  meta.appendChild(badge);
  meta.appendChild(metaRest);
  info.appendChild(meta);

  const stambarOuter = document.createElement("div");
  stambarOuter.className = "stambar-outer";
  const stambarFill = document.createElement("div");
  stambarFill.className = "stambar-fill";
  stambarOuter.appendChild(stambarFill);
  info.appendChild(stambarOuter);

  // Discoverability hint for the right-click menu/double-click-to-open,
  // shown only on hover/selected (CSS) and only once it actually has text
  // (`updateRow` clears it for anything but a Completed row with a real
  // file). Deliberately plain inline content inside `.info` -- a native
  // `title=""` tooltip floats whatever the OS/browser decides, which could
  // land right on top of the context menu it's hinting at; this can only
  // ever push this row's own layout, never float over anything else.
  const hint = document.createElement("div");
  hint.className = "hint";
  info.appendChild(hint);

  row.appendChild(info);

  const actions = document.createElement("div");
  actions.className = "actions";
  row.appendChild(actions);

  // Popover: closed by default (`.hidden`), toggled open by this row's
  // LIMIT or PICK ▾ action button (see `makeToggleButton`). `.row` needs
  // `position:relative` (in CSS) so this `position:absolute` popover
  // anchors under the trigger instead of the page. Built once per row
  // here -- a row's kind (and so which popover it needs) never changes --
  // and only its *contents* are updated in place afterward.
  const popover = document.createElement("div");
  popover.className = "popover hidden";
  row.appendChild(popover);

  const els = {
    row,
    svgIcon,
    iconKey: null,
    fname,
    badge,
    metaRest,
    stambarOuter,
    stambarFill,
    hint,
    actions,
    actionsKey: null,
    popover,
    currentItem: null,
  };

  // Right-click for the full action menu (FDM/IDM-style), double-click a
  // finished row to open its file directly -- both read `els.currentItem`
  // at the moment of the event (kept fresh every poll by `updateRow`), not
  // whatever `item` this row happened to be created with.
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const current = els.currentItem;
    if (!current) return;
    const groups = contextMenuItemsFor(current);
    if (!groups.length) return;
    openContextMenu(row, event.clientX, event.clientY, groups);
  });
  row.addEventListener("dblclick", () => {
    const current = els.currentItem;
    if (!current || current.status !== "Completed") return;
    const path = current.kind === "extract" ? current.final_path : current.dest_path;
    if (!path) return;
    invoke("open_path_in_default_app", { path }).catch((err) =>
      console.error("open_path_in_default_app failed:", err),
    );
  });

  if (isExtract) {
    const ptitle = document.createElement("div");
    ptitle.className = "ptitle";
    ptitle.textContent = "Choose a quality";
    const pickList = document.createElement("div");
    pickList.className = "picklist";
    popover.appendChild(ptitle);
    popover.appendChild(pickList);
    els.pickList = pickList;
    els.formatsKey = null;
  } else {
    // Per-download speed limit, applied via the existing
    // `set_download_speed_limit` command -- today's exact call, just moved
    // from an always-visible inline input+button into this popover.
    const ptitle = document.createElement("div");
    ptitle.className = "ptitle";
    ptitle.textContent = "Speed limit";
    const prow = document.createElement("div");
    prow.className = "prow";
    const limitInput = document.createElement("input");
    limitInput.type = "text";
    limitInput.inputMode = "numeric";
    limitInput.placeholder = "no limit (bytes/sec)";
    limitInput.title = "Speed limit for this download, in bytes/sec (empty or 0 = no limit)";
    const limitButton = document.createElement("button");
    limitButton.type = "button";
    limitButton.className = "actbtn";
    limitButton.textContent = "Set";
    limitButton.title = "Apply this speed limit";
    limitButton.addEventListener("click", async () => {
      limitButton.disabled = true;
      try {
        await invoke("set_download_speed_limit", {
          id: item.id,
          bytesPerSec: parseSpeedLimit(limitInput.value),
        });
        closePopover(els);
        await refreshList();
      } catch (err) {
        console.error("set_download_speed_limit failed:", err);
      } finally {
        limitButton.disabled = false;
      }
    });
    prow.appendChild(limitInput);
    prow.appendChild(limitButton);
    popover.appendChild(ptitle);
    popover.appendChild(prow);
    els.limitInput = limitInput;
  }

  return els;
}

// Removing a Completed entry asks whether to delete the finished file too;
// only an explicit "OK" deletes it. Every other status just removes the
// entry (the backend only ever cleans up its own partial files for those).
async function removeDownload(download) {
  if (download.status === "Completed") {
    const deleteFile = window.confirm(
      `Delete the downloaded file "${download.filename}" too?\n\n` +
        "OK: remove from the list AND delete the file from disk.\n" +
        "Cancel: remove from the list only, keep the file.",
    );
    if (deleteFile) {
      await invoke("remove_download_and_delete_file", { id: download.id });
      return;
    }
  }
  await invoke("remove_download", { id: download.id });
}

function actionsFor(item, els) {
  return item.kind === "extract" ? actionsForExtract(item, els) : actionsForDownload(item, els);
}

// Each entry is either `{ kind: "invoke", label, onClick, danger }` (built
// into a real button via `makeActionButton`, same disable/invoke/refresh
// wrapper as before) or `{ kind: "toggle", label, popover }` (built via
// `makeToggleButton`, which only shows/hides `popover` and never calls
// `invoke` itself -- see `buildActionButton`).
function actionsForDownload(download, els) {
  const id = download.id;
  const actions = [];
  if (download.status === "Downloading") {
    actions.push({ kind: "invoke", label: "Pause", onClick: () => invoke("pause_download", { id }) });
  }
  if (download.status === "Paused") {
    actions.push({ kind: "invoke", label: "Resume", onClick: () => invoke("resume_download", { id }) });
  }
  if (download.status === "Failed") {
    actions.push({ kind: "invoke", label: "Retry", onClick: () => invoke("retry_download", { id }) });
  }
  // Today's exact `limitable` rule, unchanged: every status except
  // Completed/Canceled -- this is the gate the plan's Review Focus calls
  // out by name, so it must keep matching `updateDownloadRow`'s historical
  // behavior precisely, not the mockup's example rows (which happen not to
  // show Limit on a Failed row, even though Failed is "limitable" here).
  const limitable = !["Completed", "Canceled"].includes(download.status);
  if (limitable) {
    actions.push({ kind: "toggle", label: "Limit", popover: els.popover });
  }
  if (["Queued", "Downloading", "Paused"].includes(download.status)) {
    actions.push({ kind: "invoke", label: "Cancel", onClick: () => invoke("cancel_download", { id }), danger: true });
  }
  // Remove used to show unconditionally, on every status -- including
  // while a download was actively downloading, letting it be removed from
  // the list mid-transfer with no cancel step at all. Gated to terminal
  // statuses now, same as extract jobs' Remove (EXTRACT_TERMINAL_STATUSES)
  // below.
  if (TERMINAL_STATUSES.includes(download.status)) {
    actions.push({
      kind: "invoke",
      label: "Remove",
      onClick: () => removeDownload(download),
      danger: download.status === "Failed",
    });
  }
  return actions;
}

// Extract jobs only ever get Cancel (while a subprocess could still be
// running), Retry (once Failed), and Remove (once in any terminal status)
// -- never Pause/Resume (yt-dlp can't be paused mid-probe/download).
// Extract rows never get a Limit action/popover -- no backend command
// exists for an extract job's speed. `AwaitingFormatChoice` (which is also
// one of `EXTRACT_CANCELABLE_STATUSES`) additionally gets Choose ▾,
// replacing today's inline `<select>` + "Download" button with this row's
// popover.
function actionsForExtract(job, els) {
  const id = job.id;
  const actions = [];
  if (job.status === "AwaitingFormatChoice") {
    actions.push({ kind: "toggle", label: "Choose ▾", popover: els.popover });
  }
  if (EXTRACT_CANCELABLE_STATUSES.includes(job.status)) {
    actions.push({ kind: "invoke", label: "Cancel", onClick: () => invoke("cancel_extract_job", { id }), danger: true });
  }
  if (job.status === "Failed") {
    actions.push({ kind: "invoke", label: "Retry", onClick: () => invoke("retry_extract_job", { id }) });
  }
  if (EXTRACT_TERMINAL_STATUSES.includes(job.status)) {
    actions.push({ kind: "invoke", label: "Remove", onClick: () => invoke("remove_extract_job", { id }) });
  }
  return actions;
}

// Right-click menu content for a row, grouped the same way the menu
// renders them (a `.pickdiv` divider between each non-empty group): file
// actions (only once a real finished file exists), copying the original
// source link, the row's own status action (mirrors `actionsForDownload`/
// `actionsForExtract` above, minus the LIMIT/PICK popovers -- those stay
// button-only), then Remove. Returns an array of groups (each an array of
// `{ label, onClick, danger?, skipRefresh? }`); an empty group is never
// included, so the caller never has to guard against a leading/trailing/
// doubled divider.
function contextMenuItemsFor(item) {
  const isExtract = item.kind === "extract";
  const id = item.id;
  const groups = [];

  const filePath = isExtract ? item.final_path : item.dest_path;
  if (item.status === "Completed" && filePath) {
    groups.push([
      { label: "Open file", onClick: () => invoke("open_path_in_default_app", { path: filePath }) },
      { label: "Open file location", onClick: () => invoke("reveal_path_in_file_manager", { path: filePath }) },
    ]);
  }

  const linkUrl = isExtract ? item.source_url : item.url;
  if (linkUrl) {
    groups.push([
      {
        label: "Copy download link",
        skipRefresh: true,
        onClick: () => navigator.clipboard.writeText(linkUrl),
      },
    ]);
  }

  const statusGroup = [];
  if (isExtract) {
    if (item.status === "Failed") {
      statusGroup.push({ label: "Retry", onClick: () => invoke("retry_extract_job", { id }) });
    }
    if (EXTRACT_CANCELABLE_STATUSES.includes(item.status)) {
      statusGroup.push({ label: "Cancel", danger: true, onClick: () => invoke("cancel_extract_job", { id }) });
    }
  } else {
    if (item.status === "Downloading") {
      statusGroup.push({ label: "Pause", onClick: () => invoke("pause_download", { id }) });
    }
    if (item.status === "Paused") {
      statusGroup.push({ label: "Resume", onClick: () => invoke("resume_download", { id }) });
    }
    if (item.status === "Failed") {
      statusGroup.push({ label: "Retry", onClick: () => invoke("retry_download", { id }) });
    }
    if (["Queued", "Downloading", "Paused"].includes(item.status)) {
      statusGroup.push({ label: "Cancel", danger: true, onClick: () => invoke("cancel_download", { id }) });
    }
  }
  if (statusGroup.length) groups.push(statusGroup);

  const terminal = isExtract
    ? EXTRACT_TERMINAL_STATUSES.includes(item.status)
    : TERMINAL_STATUSES.includes(item.status);
  if (terminal) {
    groups.push([
      {
        label: "Remove",
        danger: item.status === "Failed",
        onClick: () => (isExtract ? invoke("remove_extract_job", { id }) : removeDownload(item)),
      },
    ]);
  }

  return groups;
}

// One shared context-menu element, reused for every row (repopulated and
// repositioned on each right-click) rather than one per row -- a row's
// menu contents depend only on its current status, so there is nothing a
// per-row instance would preserve between opens.
const contextMenuEl = document.createElement("div");
contextMenuEl.className = "popover ctxmenu hidden";
document.body.appendChild(contextMenuEl);

// The row the open menu belongs to, highlighted (`.row.selected`,
// styles.css) for as long as the menu stays open -- same convention as
// FDM/IDM's own row context menu, not a brief flash.
let selectedMenuRow = null;

function closeContextMenu() {
  contextMenuEl.classList.add("hidden");
  selectedMenuRow?.classList.remove("selected");
  selectedMenuRow = null;
}

function openContextMenu(row, clientX, clientY, groups) {
  selectedMenuRow?.classList.remove("selected");
  selectedMenuRow = row;
  row.classList.add("selected");
  contextMenuEl.replaceChildren(
    ...groups.flatMap((group, groupIndex) => {
      const divider = [];
      if (groupIndex > 0) {
        const div = document.createElement("div");
        div.className = "pickdiv";
        divider.push(div);
      }
      const buttons = group.map((entry) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = entry.danger ? "pick danger" : "pick";
        button.textContent = entry.label;
        button.addEventListener("click", async () => {
          closeContextMenu();
          try {
            await entry.onClick();
            if (!entry.skipRefresh) await refreshList();
          } catch (err) {
            console.error(`${entry.label} failed:`, err);
          }
        });
        return button;
      });
      return [...divider, ...buttons];
    }),
  );
  contextMenuEl.classList.remove("hidden");

  // Measured only after the menu has real content, then clamped so a
  // right-click near the window's edge never renders it partly off-screen.
  const rect = contextMenuEl.getBoundingClientRect();
  const maxX = Math.max(4, window.innerWidth - rect.width - 4);
  const maxY = Math.max(4, window.innerHeight - rect.height - 4);
  contextMenuEl.style.left = `${Math.max(4, Math.min(clientX, maxX))}px`;
  contextMenuEl.style.top = `${Math.max(4, Math.min(clientY, maxY))}px`;
}

// Closes the context menu on an ordinary left-click anywhere outside it,
// on Escape, and on a *second* right-click landing outside it (each row's
// own `contextmenu` handler calls `stopPropagation`, so right-clicking the
// row that's opening a menu never immediately closes the menu it just
// opened via this same listener).
document.addEventListener("click", (event) => {
  if (!contextMenuEl.contains(event.target)) closeContextMenu();
});
document.addEventListener("contextmenu", closeContextMenu);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeContextMenu();
});

function updateRow(els, item) {
  // Kept fresh on every poll so the row's `contextmenu`/`dblclick`
  // listeners (bound once, in `createRow`) always act on current data --
  // status, `dest_path`/`final_path`, `url`/`source_url` -- not whatever
  // the row happened to show when it was first created.
  els.currentItem = item;

  const filePath = item.kind === "extract" ? item.final_path : item.dest_path;
  // Shown on hover/selected via CSS (`.row:hover .hint`/`.row.selected
  // .hint`); empty text means nothing to show, so hovering a row with no
  // file yet (nothing to open) reveals no hint at all.
  els.hint.textContent =
    item.status === "Completed" && filePath ? "Double-click to open · right-click for more" : "";

  if (item.kind === "extract") {
    updateExtractRow(els, item);
  } else {
    updateDownloadRow(els, item);
  }
}

function updateDownloadRow(els, download) {
  if (els.fname.textContent !== download.filename) {
    els.fname.textContent = download.filename;
  }

  // Icon only re-rendered when the filename actually changes (it's fixed
  // per download in practice, but `els.iconKey` guards it the same way
  // `actionsKey` guards the action buttons below).
  const iconKey = download.filename;
  if (els.iconKey !== iconKey) {
    els.iconKey = iconKey;
    renderIconInto(els.svgIcon, iconCellsForFilename(download.filename));
  }

  const pct = progressPercent(download);
  els.stambarFill.style.width = `${pct ?? 0}%`;
  els.stambarOuter.classList.toggle("indeterminate", pct == null);
  els.stambarOuter.classList.toggle("hidden", TERMINAL_STATUSES.includes(download.status));
  // Paused rows render the fill in `--ink-dim` (spec Appendix A
  // mockup row) so a paused download reads visually distinct from an
  // actively-downloading one; every other status keeps the CSS default
  // (`--stamina`, set on `.stambar-fill` itself) by clearing the inline
  // override.
  els.stambarFill.style.background = download.status === "Paused" ? "var(--ink-dim)" : "";

  const [badgeWord, badgeColor] = DOWNLOAD_BADGE[download.status] ?? ["", "var(--ink-dim)"];
  if (els.badge.textContent !== badgeWord) {
    els.badge.textContent = badgeWord;
  }
  els.badge.style.color = badgeColor;

  // One meta line: badge + size/speed normally, or badge + the error text
  // (both colored berry) when the download has failed -- same `error`
  // field, just no longer a separate `.download-error` block below.
  const speed = liveSpeedBytesPerSec(els, download.downloaded_bytes, download.status === "Downloading");
  const sizeText = sizeAndSpeedText(download.downloaded_bytes, download.total_bytes, speed);
  const errorText = download.error || "";
  const restText = errorText ? ` — ${errorText}` : ` — ${sizeText}`;
  if (els.metaRest.textContent !== restText) {
    els.metaRest.textContent = restText;
  }
  els.metaRest.style.color = errorText ? "var(--berry)" : "";

  // Buttons only change when the status does, so they are only rebuilt
  // then -- a click in progress is never interrupted by an ordinary poll.
  // The handlers close over this snapshot of `download`, which is fine:
  // everything they read (id, status, filename) is fixed for as long as
  // the status (and therefore these buttons) stays the same.
  const actionsKey = `${download.status}|${download.filename}`;
  if (els.actionsKey !== actionsKey) {
    els.actionsKey = actionsKey;
    els.actions.replaceChildren(...actionsFor(download, els).map(buildActionButton));
    // The LIMIT button (and so any reason to have this popover open) may
    // no longer exist after a status change -- close it rather than leave
    // it open against a trigger button that just got replaced.
    els.popover.classList.add("hidden");
  }
}

function updateExtractRow(els, job) {
  const titleText = job.title || job.source_url;
  if (els.fname.textContent !== titleText) {
    els.fname.textContent = titleText;
  }

  // Extract rows always show the film icon (spec: "everything else,
  // including all video/extract rows, -> film icon") -- rendered once,
  // never re-sniffed from `job.title`/`job.source_url`.
  if (els.iconKey !== "extract") {
    els.iconKey = "extract";
    renderIconInto(els.svgIcon, filmCells);
  }

  const awaitingChoice = job.status === "AwaitingFormatChoice";
  els.stambarOuter.classList.toggle("hidden", awaitingChoice || TERMINAL_STATUSES.includes(job.status));

  if (awaitingChoice) {
    // Pick rows only rebuilt when the set of labels actually changes, so
    // the popover's contents survive an ordinary poll while it's open.
    const formatsKey = job.formats.map((f) => f.label).join("|");
    if (els.formatsKey !== formatsKey) {
      els.formatsKey = formatsKey;
      els.pickList.replaceChildren(
        ...job.formats.map((format) => {
          const pickButton = document.createElement("button");
          pickButton.type = "button";
          pickButton.className = "pick";
          pickButton.textContent = format.label;
          // Today's exact `choose_extract_format` call, just invoked
          // directly from the popover row instead of a <select> + separate
          // "Download" button -- one click picks and starts, no confirm
          // step, per the brief.
          pickButton.addEventListener("click", async () => {
            pickButton.disabled = true;
            try {
              await invoke("choose_extract_format", {
                id: job.id,
                formatLabel: format.label,
              });
              closePopover(els);
              await refreshList();
            } catch (err) {
              console.error("choose_extract_format failed:", err);
            } finally {
              pickButton.disabled = false;
            }
          });
          return pickButton;
        }),
      );
    }
  } else {
    const pct = progressPercent(job);
    els.stambarFill.style.width = `${pct ?? 0}%`;
    els.stambarOuter.classList.toggle("indeterminate", pct == null);
  }

  const [badgeWord, badgeColor] = EXTRACT_BADGE[job.status] ?? ["", "var(--ink-dim)"];
  if (els.badge.textContent !== badgeWord) {
    els.badge.textContent = badgeWord;
  }
  els.badge.style.color = badgeColor;

  const speed = liveSpeedBytesPerSec(els, job.downloaded_bytes, job.status === "Downloading");
  const sizeText = sizeAndSpeedText(job.downloaded_bytes, job.total_bytes, speed);
  const errorText = job.error || "";
  let restText = "";
  if (errorText) {
    restText = ` — ${errorText}`;
  } else if (!awaitingChoice) {
    restText = ` — ${sizeText}`;
  }
  if (els.metaRest.textContent !== restText) {
    els.metaRest.textContent = restText;
  }
  els.metaRest.style.color = errorText ? "var(--berry)" : "";

  const actionsKey = `${job.status}|${job.title}`;
  if (els.actionsKey !== actionsKey) {
    els.actionsKey = actionsKey;
    els.actions.replaceChildren(...actionsFor(job, els).map(buildActionButton));
    els.popover.classList.add("hidden");
  }
}

function makeActionButton(label, onClick, danger) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = danger ? "actbtn danger" : "actbtn";
  button.textContent = label;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await onClick();
      await refreshList();
    } catch (err) {
      console.error(`${label} failed:`, err);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

// LIMIT / PICK ▾ trigger buttons never call `invoke` themselves -- clicking
// one only shows/hides this row's own popover (built once in `createRow`;
// its SET button / `.pick` rows are what actually call `invoke`). `.active`
// (spec: solid ink background) marks the currently-open trigger.
function makeToggleButton(label, popoverEl) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "actbtn";
  button.textContent = label;
  button.addEventListener("click", () => {
    const opening = popoverEl.classList.contains("hidden");
    popoverEl.classList.toggle("hidden", !opening);
    button.classList.toggle("active", opening);
  });
  return button;
}

function buildActionButton(action) {
  if (action.kind === "toggle") {
    return makeToggleButton(action.label, action.popover);
  }
  return makeActionButton(action.label, action.onClick, action.danger);
}

// Closes a row's popover AND clears its trigger button's `.active` state.
// The `actionsKey`-change path in `updateDownloadRow`/`updateExtractRow`
// doesn't need this (it calls `els.actions.replaceChildren(...)`, which
// throws away the old trigger button -- any stale `.active` class goes
// with it). This is for the other path: closing a popover programmatically
// after a successful SET/pick click, where nothing guarantees `actionsKey`
// changes (e.g. setting a speed limit never changes `download.status`), so
// without this the LIMIT/PICK trigger would stay visually "stuck" in its
// solid-ink active state after the popover is actually closed.
function closePopover(els) {
  els.popover.classList.add("hidden");
  els.actions.querySelector(".active")?.classList.remove("active");
}

// Extract-job rows are kept in `rowsById` alongside HTTP download rows,
// keyed by this prefixed id so a yt-dlp job's uuid can never collide with
// an HTTP download's.
function rowIdFor(item) {
  return item.kind === "extract" ? `x:${item.id}` : item.id;
}

// Last-known-good lists, used so a transient failure of one `invoke` call
// below leaves that kind's rows exactly as they were on screen (matching
// the pre-extract-jobs behavior of freezing in place) instead of the
// merged `items` list silently omitting that kind and the prune loop
// deleting every one of its rows for a single missed poll.
let lastDownloads = [];
let lastExtractJobs = [];

// Cached copy of the persisted settings, kept in sync by every place that
// loads or saves them (the Settings panel's open handler and its form
// submit), so `handleStatusTransition` below can check `harvest_chime`/
// `auto_replant_failed` on every poll without an `invoke` round-trip per
// row per poll. Defaults match `SettingsDto::default()` until the real
// startup fetch (below) resolves.
let currentSettings = { harvest_chime: true, auto_replant_failed: false, start_with_the_season: true };
invoke("get_settings")
  .then((settings) => {
    currentSettings = settings;
  })
  .catch((err) => console.error("Failed to load settings:", err));

// How many times `handleStatusTransition` has auto-retried a row since its
// last non-Failed status, keyed by `rowIdFor`'s id. Capped so a download/
// extraction that keeps failing the same way doesn't retry forever; reset
// (by deletion) the moment a row is seen in any status other than Failed,
// so a later, unrelated failure of the same row starts counting fresh.
const autoReplantCounts = new Map();
const AUTO_REPLANT_MAX_ATTEMPTS = 3;

// Plays a short two-tone "item get" chime via the Web Audio API --
// synthesized at runtime rather than shipping a sound asset, so there's
// no licensing/sourcing question for what file to bundle. Never throws:
// AudioContext can be unavailable (and in some browsers requires a prior
// user gesture, which every path that calls this already follows, since
// it only ever fires off the back of a poll reacting to a download the
// user themselves started).
function playHarvestChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [660, 990].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      const start = now + i * 0.09;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.15, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    });
    setTimeout(() => ctx.close().catch(() => {}), 500);
  } catch (err) {
    // No Web Audio support, or the browser blocked it -- the chime is a
    // nice-to-have, never worth surfacing an error for.
  }
}

// Reacts to a row's status actually CHANGING since the last poll --
// never to its current value alone, so a job that was already Completed/
// Failed when the app started (or when this row was first seen) never
// fires a chime or an auto-retry it didn't just newly earn. `els.lastStatus`
// is `undefined` on a row's first sight, which the `previousStatus != null`
// check below treats the same as "not already Completed/Failed".
function handleStatusTransition(rowId, els, item) {
  const previousStatus = els.lastStatus;
  els.lastStatus = item.status;

  if (previousStatus != null && previousStatus !== "Completed" && item.status === "Completed") {
    if (currentSettings.harvest_chime) {
      playHarvestChime();
    }
  }

  if (item.status !== "Failed") {
    autoReplantCounts.delete(rowId);
    return;
  }

  if (previousStatus != null && previousStatus !== "Failed" && currentSettings.auto_replant_failed) {
    const attempts = autoReplantCounts.get(rowId) ?? 0;
    if (attempts < AUTO_REPLANT_MAX_ATTEMPTS) {
      autoReplantCounts.set(rowId, attempts + 1);
      const command = item.kind === "extract" ? "retry_extract_job" : "retry_download";
      invoke(command, { id: item.id }).catch((err) => console.error(`${command} failed:`, err));
    }
  }
}

// Status bar text: "<N> downloads" / "<M> active" normally, or
// "0 downloads" / "No active downloads" when the merged list is empty.
// "Downloading" is the badge word both `DOWNLOAD_BADGE.Downloading` and
// `EXTRACT_BADGE.Downloading` map to -- the only status either mapping
// gives that word, so counting `status === "Downloading"` directly here
// matches it without needing that mapping object to exist yet.
//
// "download"/"downloads" is a countable noun, so it's singular for
// exactly 1 ("1 download") and plural otherwise ("0 downloads"/
// "2 downloads"), rather than always appending the plural noun. "active"
// is a status word, not a countable noun, so it's never pluralized --
// "1 active" and "2 active" are both already correct.
function updateStatusBar(items) {
  const n = items.length;
  statusTasksEl.textContent = `${n} ${n === 1 ? "download" : "downloads"}`;
  if (n === 0) {
    statusWorkingEl.textContent = "No active downloads";
  } else {
    const working = items.filter((item) => item.status === "Downloading").length;
    statusWorkingEl.textContent = `${working} active`;
  }
}

async function refreshList() {
  let downloads = lastDownloads;
  try {
    downloads = (await invoke("list_downloads")) || [];
    lastDownloads = downloads;
  } catch (err) {
    console.error("Failed to list downloads:", err);
  }

  let extractJobs = lastExtractJobs;
  try {
    extractJobs = (await invoke("list_extract_jobs")) || [];
    lastExtractJobs = extractJobs;
  } catch (err) {
    console.error("Failed to list extract jobs:", err);
  }

  const items = [
    ...downloads.map((download) => ({ ...download, kind: "http" })),
    ...extractJobs.map((job) => ({ ...job, kind: "extract" })),
  ];

  const isEmpty = items.length === 0;
  emptyStateEl.classList.toggle("hidden", !isEmpty);
  queueListEl.classList.toggle("hidden", isEmpty);
  // The empty state has its own "+ Add download" button -- showing the
  // addrow above the list too, on top of it, is a redundant second way to
  // do the exact same thing while the list is empty.
  addrowBtn.classList.toggle("hidden", isEmpty);
  updateStatusBar(items);

  const seen = new Set();
  let previous = null;
  for (const item of items) {
    const rowId = rowIdFor(item);
    seen.add(rowId);
    let els = rowsById.get(rowId);
    if (!els) {
      els = createRow(item);
      rowsById.set(rowId, els);
    }
    updateRow(els, item);
    handleStatusTransition(rowId, els, item);

    // Keep DOM order matching the backend's order, moving a row only if
    // it's actually out of place (moving detaches it, which would also
    // interrupt a click).
    const expectedNext = previous ? previous.nextSibling : queueListEl.firstChild;
    if (expectedNext !== els.row) {
      queueListEl.insertBefore(els.row, expectedNext);
    }
    previous = els.row;
  }

  for (const [id, els] of rowsById) {
    if (!seen.has(id)) {
      els.row.remove();
      rowsById.delete(id);
    }
  }
}

function openPanel(panelEl) {
  panelEl.classList.remove("hidden");
}

function closePanel(panelEl) {
  panelEl.classList.add("hidden");
}

function showError(el, message) {
  el.textContent = message;
  el.classList.remove("hidden");
}

function hideError(el) {
  el.classList.add("hidden");
}

// Neutral status-text helper, same idiom as the existing yt-dlp update
// status line (`ytdlpUpdateStatusEl`, below): plain `.ssub` text by
// default, only gaining `.error` (the existing global `.ssub.error` rule)
// when `isError` is true. Unlike `showError`/`hideError` above -- which
// always mean "a real failure happened" -- this is for a status line that
// is shown on every attempt, success included, so a normal confirmation
// never renders in error-red just because it happens to share the display
// mechanics of an error message.
function setStatus(el, message, isError) {
  el.textContent = message;
  el.classList.toggle("error", Boolean(isError));
}

// Opens the Add Download panel -- today's #open-add-btn's job, now
// triggered from two places (Step 3's always-visible .addrow row and the
// empty state's own .ebtn), both wired to this one function so there's
// exactly one way the panel actually opens.
function openAddPanel() {
  addFormEl.reset();
  hideError(addErrorEl);
  openPanel(addPanelEl);
}
addrowBtn.addEventListener("click", openAddPanel);
emptyAddBtn.addEventListener("click", openAddPanel);

document.getElementById("cancel-add-btn").addEventListener("click", () => {
  closePanel(addPanelEl);
});

document.getElementById("add-panel-close").addEventListener("click", () => {
  closePanel(addPanelEl);
});

addFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError(addErrorEl);

  const url = addUrlEl.value.trim();
  const filename = addFilenameEl.value.trim();

  try {
    await invoke("add_download", { url, filename: filename || null });
    closePanel(addPanelEl);
    await refreshList();
  } catch (err) {
    showError(addErrorEl, String(err));
  }
});

function setSwitch(el, on) {
  el.classList.toggle("on", on);
  el.classList.toggle("off", !on);
}

function isSwitchOn(el) {
  return el.classList.contains("on");
}

// Opens the Settings panel -- today's #open-settings-btn's job, now
// triggered from the status bar's .shedbtn (Step 4).
// Renders a paired-profile's `paired_at` (Unix seconds, from the backend --
// see `PairedProfile`'s doc comment) in the viewer's own locale/timezone,
// which is simpler and more correct than formatting a date in Rust ever
// could be from here.
function formatPairedAt(unixSeconds) {
  try {
    return new Date(unixSeconds * 1000).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch (err) {
    return "";
  }
}

// Rebuilds the Settings panel's "Paired browsers" list from scratch --
// called whenever the panel opens and after any forget/rename, never kept
// in sync incrementally like the queue rows above (this list is short and
// only ever open while the user is actively looking at it, unlike the
// queue's own continuous poll).
async function refreshPairedProfiles() {
  let profiles = [];
  try {
    profiles = (await invoke("list_paired_profiles")) || [];
  } catch (err) {
    console.error("list_paired_profiles failed:", err);
  }

  pairedProfilesEmptyEl.classList.toggle("hidden", profiles.length > 0);

  pairedProfilesListEl.replaceChildren(
    ...profiles.map((profile) => {
      const row = document.createElement("div");
      row.className = "profilerow";

      const label = document.createElement("input");
      label.type = "text";
      label.className = "profilelabel";
      label.value = profile.label;
      label.addEventListener("change", async () => {
        const value = label.value.trim() || profile.label;
        label.value = value;
        try {
          await invoke("rename_paired_profile", { id: profile.id, label: value });
        } catch (err) {
          console.error("rename_paired_profile failed:", err);
        }
      });
      row.appendChild(label);

      const date = document.createElement("span");
      date.className = "profiledate";
      date.textContent = `paired ${formatPairedAt(profile.paired_at)}`;
      row.appendChild(date);

      const forget = document.createElement("button");
      forget.type = "button";
      forget.className = "changebtn danger";
      forget.textContent = "Forget";
      forget.addEventListener("click", async () => {
        const confirmed = window.confirm(
          `Forget "${profile.label}"? That browser will need to pair again before it can send downloads here.`,
        );
        if (!confirmed) return;
        forget.disabled = true;
        try {
          await invoke("forget_paired_profile", { id: profile.id });
          await refreshPairedProfiles();
        } catch (err) {
          console.error("forget_paired_profile failed:", err);
          forget.disabled = false;
        }
      });
      row.appendChild(forget);

      return row;
    }),
  );
}

const ALLOW_PAIRING_IDLE_TEXT = "Lets one more browser profile connect, for 2 minutes";
let pairingCountdownId = null;

function formatCountdown(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// Drives the "Allow" button's live countdown from `remaining`
// seconds down to 0, ticking once a second -- called both right after the
// button is clicked (with the duration `allow_new_pairing` itself just
// opened) and when the Settings panel is reopened while an earlier click's
// window is still counting down (with whatever `pairing_mode_remaining_
// seconds` reports), so the two can never show different numbers.
function startPairingCountdown(remaining) {
  if (pairingCountdownId != null) {
    clearInterval(pairingCountdownId);
  }
  allowNewPairingBtn.disabled = true;

  const tick = () => {
    if (remaining <= 0) {
      clearInterval(pairingCountdownId);
      pairingCountdownId = null;
      allowNewPairingBtn.disabled = false;
      allowPairingStatusEl.textContent = ALLOW_PAIRING_IDLE_TEXT;
      return;
    }
    allowPairingStatusEl.textContent = `Pairing open — ${formatCountdown(remaining)} left`;
    remaining -= 1;
  };
  tick();
  pairingCountdownId = setInterval(tick, 1000);
}

allowNewPairingBtn.addEventListener("click", async () => {
  allowNewPairingBtn.disabled = true;
  try {
    const seconds = await invoke("allow_new_pairing");
    startPairingCountdown(seconds);
  } catch (err) {
    console.error("allow_new_pairing failed:", err);
    allowNewPairingBtn.disabled = false;
  }
});

shedBtn.addEventListener("click", async () => {
  hideError(settingsErrorEl);
  ytdlpUpdateStatusEl.textContent = "";
  ytdlpUpdateStatusEl.classList.remove("error");
  try {
    const settings = await invoke("get_settings");
    currentSettings = settings;
    settingsDownloadDirEl.value = settings.download_dir;
    settingsMaxConcurrentEl.value = settings.max_concurrent;
    settingsSpeedLimitEl.value = settings.default_speed_limit_bytes_per_sec ?? "";
    setSwitch(settingHarvestChimeEl, settings.harvest_chime);
    setSwitch(settingAutoReplantEl, settings.auto_replant_failed);
    setSwitch(settingStartWithSeasonEl, settings.start_with_the_season);
    openPanel(settingsPanelEl);
    await refreshPairedProfiles();
    const remaining = await invoke("pairing_mode_remaining_seconds");
    if (remaining != null && remaining > 0) {
      startPairingCountdown(remaining);
    } else if (pairingCountdownId == null) {
      allowNewPairingBtn.disabled = false;
      allowPairingStatusEl.textContent = ALLOW_PAIRING_IDLE_TEXT;
    }
  } catch (err) {
    console.error("Failed to load settings:", err);
  }
});

// Change opens the OS's native folder picker (commands::pick_download_folder)
// instead of the field taking typed paths -- `settings-download-dir` is
// `readonly` now. `null` covers the user canceling the dialog, which must
// leave the field exactly as it was, not clear it.
settingsBrowseDownloadDirEl.addEventListener("click", async () => {
  settingsBrowseDownloadDirEl.disabled = true;
  try {
    const picked = await invoke("pick_download_folder");
    if (picked) {
      settingsDownloadDirEl.value = picked;
    }
  } catch (err) {
    console.error("pick_download_folder failed:", err);
  } finally {
    settingsBrowseDownloadDirEl.disabled = false;
  }
});

settingHarvestChimeEl.addEventListener("click", () => {
  setSwitch(settingHarvestChimeEl, !isSwitchOn(settingHarvestChimeEl));
});

settingAutoReplantEl.addEventListener("click", () => {
  setSwitch(settingAutoReplantEl, !isSwitchOn(settingAutoReplantEl));
});

// Unlike the two switches above (applied on Save, with everything else in
// this form), "Start with the season" applies immediately on click, via
// the dedicated `set_autostart` command -- a toggle for a real OS-level
// effect reads as instant, not as a field that waits for a Save button.
settingStartWithSeasonEl.addEventListener("click", async () => {
  const next = !isSwitchOn(settingStartWithSeasonEl);
  setSwitch(settingStartWithSeasonEl, next);
  settingStartWithSeasonEl.disabled = true;
  try {
    await invoke("set_autostart", { enabled: next });
    currentSettings.start_with_the_season = next;
  } catch (err) {
    console.error("set_autostart failed:", err);
    setSwitch(settingStartWithSeasonEl, !next);
  } finally {
    settingStartWithSeasonEl.disabled = false;
  }
});

checkYtdlpUpdateBtn.addEventListener("click", async () => {
  checkYtdlpUpdateBtn.disabled = true;
  ytdlpUpdateStatusEl.classList.remove("error");
  ytdlpUpdateStatusEl.textContent = "Checking…";
  try {
    const message = await invoke("check_ytdlp_update");
    ytdlpUpdateStatusEl.textContent = message;
  } catch (err) {
    ytdlpUpdateStatusEl.textContent = String(err);
    ytdlpUpdateStatusEl.classList.add("error");
  } finally {
    checkYtdlpUpdateBtn.disabled = false;
  }
});

document.getElementById("cancel-settings-btn").addEventListener("click", () => {
  closePanel(settingsPanelEl);
});

document.getElementById("settings-panel-close").addEventListener("click", () => {
  closePanel(settingsPanelEl);
});

// Opens the Browser Companion Setup Guide popup -- the Settings panel's own
// "Set up" row button, same openPanel pattern as shedBtn opening Settings
// itself. Settings is closed first so the two popups' dimmed `.panel`
// backdrops never stack (there's no scenario where seeing both at once is
// useful, and nothing else in this codebase layers one popup over another).
browserSetupBtn.addEventListener("click", () => {
  hideError(browserSetupErrorEl);
  setStatus(setupPageStatusEl, "", false);
  closePanel(settingsPanelEl);
  openPanel(browserSetupPanelEl);
});

document.getElementById("browser-setup-panel-close").addEventListener("click", () => {
  closePanel(browserSetupPanelEl);
});

// SKIP FOR NOW / "I'VE INSTALLED IT" are both plain dismiss actions -- this
// round adds no persisted "has the user set up the extension" state (see
// the spec's Appendix C wiring notes), so there's nothing to tell them apart
// yet.
document.getElementById("setup-skip-btn").addEventListener("click", () => {
  closePanel(browserSetupPanelEl);
});
document.getElementById("setup-done-btn").addEventListener("click", () => {
  closePanel(browserSetupPanelEl);
});

// "Open page" -- copies chrome://extensions to the clipboard via the real
// `open_extensions_page` command (Task 3's backend). That command is
// clipboard-only on purpose: chrome://extensions has no registered OS
// protocol handler on a typical system, so attempting to open it would be
// likely to pop the OS's own "choose an app" dialog instead of doing
// anything useful -- see that command's own doc comment. The confirmation
// message is shown via `setStatus` (not `showError`/the red
// `#browser-setup-error`) specifically so this routine confirmation never
// renders as if something had gone wrong -- only the rare case where the
// clipboard write itself fails is a real error, and that's surfaced
// through this same status line via `isError: true`.
setupOpenPageBtn.addEventListener("click", async () => {
  setupOpenPageBtn.disabled = true;
  try {
    const message = await invoke("open_extensions_page");
    setStatus(setupPageStatusEl, message, false);
  } catch (err) {
    setStatus(setupPageStatusEl, String(err), true);
  } finally {
    setupOpenPageBtn.disabled = false;
  }
});

// "Open folder" -- opens the bundled extension/ folder (Task 3's backend
// resolves it via the resource-directory API) in the OS file explorer. A
// successful open is its own confirmation (the explorer window appearing),
// so only a failure needs an inline message here.
setupOpenFolderBtn.addEventListener("click", async () => {
  hideError(browserSetupErrorEl);
  setupOpenFolderBtn.disabled = true;
  try {
    await invoke("open_extension_folder");
  } catch (err) {
    showError(browserSetupErrorEl, String(err));
  } finally {
    setupOpenFolderBtn.disabled = false;
  }
});

settingsFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError(settingsErrorEl);

  const speedLimitRaw = settingsSpeedLimitEl.value.trim();
  const settings = {
    download_dir: settingsDownloadDirEl.value.trim(),
    max_concurrent: parseInt(settingsMaxConcurrentEl.value, 10),
    default_speed_limit_bytes_per_sec: parseSpeedLimit(speedLimitRaw),
    harvest_chime: isSwitchOn(settingHarvestChimeEl),
    auto_replant_failed: isSwitchOn(settingAutoReplantEl),
    // Already applied live by its own click handler above; included here
    // too so this save can't otherwise overwrite it back to a stale value
    // (set_settings persists the whole DTO, not a diff).
    start_with_the_season: isSwitchOn(settingStartWithSeasonEl),
  };

  try {
    await invoke("set_settings", { settings });
    currentSettings = settings;
    closePanel(settingsPanelEl);
  } catch (err) {
    showError(settingsErrorEl, String(err));
  }
});

// Title bar: render the app icon once (it never changes, so this runs
// directly in init code rather than through any general icon-rendering
// helper -- Task 4 adds that plumbing for icons that do need it) and wire
// the three window-control buttons to the real Tauri window API.
const titlebarIconEl = document.getElementById("titlebar-appicon");
if (titlebarIconEl) {
  const svgNs = "http://www.w3.org/2000/svg";
  for (const cell of appCells) {
    const rect = document.createElementNS(svgNs, "rect");
    rect.setAttribute("x", cell.x);
    rect.setAttribute("y", cell.y);
    rect.setAttribute("width", "1");
    rect.setAttribute("height", "1");
    rect.setAttribute("fill", cell.fill);
    titlebarIconEl.appendChild(rect);
  }
}

// Status-bar Tool Shed icon, empty-state pot icon, Add Download panel seed
// icon, the Settings panel's about-footer app icon, and both popups' own
// title bar icon: all static (never change at runtime), so rendered once
// here via renderIconInto.
renderIconInto(shedIconEl, wrenchCells);
renderIconInto(emptyPotIconEl, emptyPotCells);
renderIconInto(addSeedIconEl, seedCells);
renderIconInto(settingsAboutIconEl, appCells);
renderIconInto(document.getElementById("add-panel-appicon"), appCells);
renderIconInto(document.getElementById("settings-panel-appicon"), appCells);
renderIconInto(document.getElementById("browser-setup-panel-appicon"), appCells);

const appWindow = getCurrentWindow();
document.getElementById("win-minimize").addEventListener("click", () => appWindow.minimize());
document.getElementById("win-maximize").addEventListener("click", () => appWindow.toggleMaximize());
document.getElementById("win-close").addEventListener("click", () => appWindow.close());

refreshList();
setInterval(refreshList, POLL_INTERVAL_MS);

// Frontend for the download ledger: polls `list_downloads`/`list_extract_jobs`
// and renders rows, plus the inline add-line, the Settings page, and the
// Browser companion setup page -- all on the same spine, no modal popups.
// Plain JS, no framework, no build step -- `window.__TAURI__` is exposed
// because `withGlobalTauri` is enabled in `tauri.conf.json`.

const { invoke } = window.__TAURI__.core;

const POLL_INTERVAL_MS = 1000;

// --- Pages: Ledger / Settings / Browser setup, swapped in place ----------
const ledgerPageEl = document.getElementById("ledger-page");
const settingsPageEl = document.getElementById("settings-page");
const browserSetupPageEl = document.getElementById("browser-setup-page");
const PAGES = [ledgerPageEl, settingsPageEl, browserSetupPageEl];

function showPage(page) {
  for (const p of PAGES) p.classList.toggle("hidden", p !== page);
}

document.getElementById("open-settings-btn").addEventListener("click", async () => {
  await refreshSettingsPage();
  showPage(settingsPageEl);
});
document.getElementById("close-settings-btn").addEventListener("click", () => showPage(ledgerPageEl));
document.getElementById("browser-setup-btn").addEventListener("click", () => showPage(browserSetupPageEl));
document.getElementById("browser-setup-later-btn").addEventListener("click", () => showPage(settingsPageEl));
document.getElementById("setup-done-btn").addEventListener("click", () => showPage(settingsPageEl));

// --- Formatting helpers (unchanged logic from before) ---------------------

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

function progressPercent(item) {
  if (!item.total_bytes) return null;
  const pct = (item.downloaded_bytes / item.total_bytes) * 100;
  return Math.max(0, Math.min(100, pct));
}

/**
 * Live transfer speed for a row, in bytes/sec, estimated from the byte
 * delta between this call and the last one for this same row -- neither
 * Tauri command's response carries a speed number. `els` is the row's
 * persistent per-id cache, so the previous sample survives across polls.
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
    if (deltaSeconds > 0) {
      const deltaBytes = Math.max(0, downloadedBytes - els.speedPrevBytes);
      els.speedLast = deltaBytes / deltaSeconds;
    }
  }
  els.speedPrevBytes = downloadedBytes;
  els.speedPrevTime = now;
  return els.speedLast ?? null;
}

function parseSpeedLimit(raw) {
  const trimmed = String(raw ?? "").trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const value = parseInt(trimmed, 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

// Status -> the single word a quiet ledger row shows at rest, and which
// `.state` color class it takes. `Downloading` never reaches this map --
// a Downloading row gets the hero treatment instead (see `render` below).
const DOWNLOAD_STATE = {
  Paused: ["Paused", ""],
  Queued: ["Queued", ""],
  Completed: ["Fetched", "success"],
  Failed: [null, "danger"], // text is the row's own error message
  Canceled: ["Canceled", ""],
};
const EXTRACT_STATE = {
  Probing: ["Fetching info", ""],
  AwaitingFormatChoice: ["Choose a quality", "warn"],
  Completed: ["Fetched", "success"],
  Failed: [null, "danger"],
  Canceled: ["Canceled", ""],
};

const EXTRACT_CANCELABLE_STATUSES = ["Probing", "AwaitingFormatChoice", "Downloading"];
const EXTRACT_TERMINAL_STATUSES = ["Completed", "Failed", "Canceled"];
const TERMINAL_STATUSES = ["Completed", "Failed", "Canceled"];

function rowIdFor(item) {
  return item.kind === "extract" ? `x:${item.id}` : item.id;
}

// --- Row DOM: each row keeps its own persistent elements across polls, so
// an in-progress hover/unfold/half-typed value never gets wiped by a poll
// landing mid-interaction. ------------------------------------------------

const rowsById = new Map();
const ledgerEl = document.getElementById("ledger");
const emptyStateEl = document.getElementById("empty-state");

let openUnfoldId = null;

function closeUnfold() {
  if (openUnfoldId == null) return;
  const els = rowsById.get(openUnfoldId);
  if (els) {
    els.unfold.classList.add("hidden");
    els.unfold.replaceChildren();
    els.wrap.classList.remove("open");
  }
  openUnfoldId = null;
}

document.addEventListener("click", (event) => {
  if (openUnfoldId == null) return;
  const els = rowsById.get(openUnfoldId);
  if (els && (els.unfold.contains(event.target) || els.desc.contains(event.target))) return;
  closeUnfold();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeUnfold();
});

function makeUnfoldOption(label, { danger = false, size = null, onClick }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = danger ? "opt danger" : "opt";
  const tick = document.createElement("span");
  tick.className = "tick";
  btn.appendChild(tick);
  btn.appendChild(document.createTextNode(label));
  if (size) {
    const sizeEl = document.createElement("span");
    sizeEl.className = "size";
    sizeEl.textContent = size;
    btn.appendChild(sizeEl);
  }
  btn.addEventListener("click", async () => {
    closeUnfold();
    try {
      await onClick();
    } catch (err) {
      console.error(`${label} failed:`, err);
    }
    await refreshList();
  });
  return btn;
}

function openUnfold(id, options) {
  const els = rowsById.get(id);
  if (!els) return;
  if (openUnfoldId === id) {
    closeUnfold();
    return;
  }
  closeUnfold();
  els.unfold.replaceChildren(...options);
  els.unfold.classList.remove("hidden");
  els.wrap.classList.add("open");
  openUnfoldId = id;
}

// Quality options for an AwaitingFormatChoice extract job -- opens the
// same unfold a right-click would, just pre-populated with sizes instead
// of actions.
function qualityOptions(job) {
  return (job.formats || []).map((format) =>
    makeUnfoldOption(format.label, {
      size: format.size_bytes != null ? formatBytes(format.size_bytes) : null,
      onClick: () => invoke("choose_extract_format", { id: job.id, formatLabel: format.label }),
    }),
  );
}

// The right-click menu's content, as unfold options instead of a floating
// menu's items. Mirrors the previous `contextMenuItemsFor`'s grouping
// logic (file actions, copy link, status action, remove) but flattened --
// the unfold has no dividers, options read top to bottom in priority
// order instead.
function rowOptions(item) {
  const isExtract = item.kind === "extract";
  const id = item.id;
  const options = [];

  const filePath = isExtract ? item.final_path : item.dest_path;
  if (item.status === "Completed" && filePath) {
    options.push(
      makeUnfoldOption("Open", { onClick: () => invoke("open_path_in_default_app", { path: filePath }) }),
      makeUnfoldOption("Open file location", {
        onClick: () => invoke("reveal_path_in_file_manager", { path: filePath }),
      }),
    );
  }
  const linkUrl = isExtract ? item.source_url : item.url;
  if (linkUrl) {
    options.push(
      makeUnfoldOption("Copy link", { onClick: async () => navigator.clipboard.writeText(linkUrl) }),
    );
  }
  if (isExtract) {
    if (item.status === "Failed") {
      options.push(makeUnfoldOption("Retry", { onClick: () => invoke("retry_extract_job", { id }) }));
    }
    if (EXTRACT_CANCELABLE_STATUSES.includes(item.status)) {
      options.push(makeUnfoldOption("Cancel", { danger: true, onClick: () => invoke("cancel_extract_job", { id }) }));
    }
  } else {
    if (item.status === "Downloading") {
      options.push(makeUnfoldOption("Pause", { onClick: () => invoke("pause_download", { id }) }));
    }
    if (item.status === "Paused") {
      options.push(makeUnfoldOption("Resume", { onClick: () => invoke("resume_download", { id }) }));
    }
    if (item.status === "Failed") {
      options.push(makeUnfoldOption("Retry", { onClick: () => invoke("retry_download", { id }) }));
    }
    if (["Queued", "Downloading", "Paused"].includes(item.status)) {
      options.push(makeUnfoldOption("Cancel", { danger: true, onClick: () => invoke("cancel_download", { id }) }));
    }
  }
  const terminal = isExtract ? EXTRACT_TERMINAL_STATUSES.includes(item.status) : TERMINAL_STATUSES.includes(item.status);
  if (terminal) {
    options.push(
      makeUnfoldOption("Remove", {
        danger: item.status === "Failed",
        onClick: () => (isExtract ? invoke("remove_extract_job", { id }) : removeDownload(item)),
      }),
    );
  }
  return options;
}

async function removeDownload(download) {
  if (download.status === "Completed") {
    const deleteFile = window.confirm(
      `Delete the downloaded file "${download.filename}" too?\n\n` +
        "OK: remove from the ledger AND delete the file from disk.\n" +
        "Cancel: remove from the ledger only, keep the file.",
    );
    if (deleteFile) {
      await invoke("remove_download_and_delete_file", { id: download.id });
      return;
    }
  }
  await invoke("remove_download", { id: download.id });
}

// Builds one row's persistent DOM: a wrap (hero or entry, `display:
// contents`) holding its three grid cells, plus an adjacent unfold cell
// that starts hidden. Created once per id, then only updated in place.
function createRowEls(id) {
  const desc = document.createElement("div");
  desc.className = "desc";
  const rule = document.createElement("div");
  rule.className = "rule-cell";
  const amt = document.createElement("div");
  amt.className = "amt";
  const state = document.createElement("span");
  state.className = "state";
  const acts = document.createElement("span");
  acts.className = "acts";
  amt.appendChild(state);
  amt.appendChild(acts);

  const wrap = document.createElement("div");
  wrap.className = "entry";
  wrap.appendChild(desc);
  wrap.appendChild(rule);
  wrap.appendChild(amt);

  const unfold = document.createElement("div");
  unfold.className = "unfold hidden";

  desc.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const current = els.currentItem;
    if (!current) return;
    openUnfold(id, rowOptions(current));
  });
  amt.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const current = els.currentItem;
    if (!current) return;
    openUnfold(id, rowOptions(current));
  });
  desc.addEventListener("dblclick", () => {
    const current = els.currentItem;
    if (!current || current.status !== "Completed") return;
    const path = current.kind === "extract" ? current.final_path : current.dest_path;
    if (!path) return;
    invoke("open_path_in_default_app", { path }).catch((err) =>
      console.error("open_path_in_default_app failed:", err),
    );
  });

  const els = { wrap, desc, rule, amt, state, acts, unfold, currentItem: null, mode: null };
  return els;
}

function ensureRow(id) {
  let els = rowsById.get(id);
  if (!els) {
    els = createRowEls(id);
    rowsById.set(id, els);
  }
  return els;
}

// Renders one item as a quiet ledger row (filename + a single status
// word, hover trades the word for actions).
function renderEntry(els, item) {
  if (els.mode !== "entry") {
    els.wrap.className = "entry";
    els.desc.className = "desc";
    els.amt.className = "amt";
    // Hero mode (if this row was ever in it) replaces `.desc`/`.amt`'s
    // children wholesale with its own kicker/name/rule and size/rate
    // elements, which detaches `state`/`acts` from the DOM -- re-attach
    // them now that this row is a plain entry again.
    els.amt.replaceChildren(els.state, els.acts);
    els.actsKey = null;
    els.mode = "entry";
  }
  els.currentItem = item;
  els.desc.textContent = item.kind === "extract" ? item.title || item.source_url : item.filename;

  const isExtract = item.kind === "extract";
  const [stateWord, stateClass] = (isExtract ? EXTRACT_STATE : DOWNLOAD_STATE)[item.status] ?? [item.status, ""];
  els.state.textContent = stateWord ?? item.error ?? "Failed";
  els.state.className = stateClass ? `state ${stateClass}` : "state";

  // AwaitingFormatChoice opens the quality picker directly, not the
  // right-click menu -- clicking the status word itself is the "choose"
  // action for that one status.
  if (item.status === "AwaitingFormatChoice") {
    els.state.style.cursor = "pointer";
    els.state.onclick = () => openUnfold(rowIdFor(item), qualityOptions(item));
  } else {
    els.state.style.cursor = "";
    els.state.onclick = null;
  }

  // Rebuilt only when the status actually changes -- rebuilding on every
  // poll could destroy one of these spans between a mousedown and its
  // mouseup, silently losing the click.
  const actsKey = `${item.status}|${item.kind === "extract" ? item.final_path : item.dest_path}`;
  if (els.actsKey !== actsKey) {
    els.actsKey = actsKey;
    els.acts.replaceChildren(...rowOptionsAsInlineActs(item));
  }
}

// The same action set `rowOptions` builds for the unfold, rendered as the
// small inline text actions a plain hover reveals (no size/tick glyph,
// just the words) -- two different presentations of one action list.
function rowOptionsAsInlineActs(item) {
  const isExtract = item.kind === "extract";
  const id = item.id;
  const acts = [];
  function act(label, { danger = false, primary = false, onClick }) {
    const span = document.createElement("span");
    span.textContent = label;
    span.className = [danger ? "danger" : "", primary ? "primary" : ""].filter(Boolean).join(" ");
    span.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await onClick();
      } catch (err) {
        console.error(`${label} failed:`, err);
      }
      await refreshList();
    });
    acts.push(span);
  }
  if (isExtract) {
    if (item.status === "Completed" && item.final_path) {
      act("Open", { onClick: () => invoke("open_path_in_default_app", { path: item.final_path }) });
    }
    if (item.status === "Failed") {
      act("Retry", { primary: true, onClick: () => invoke("retry_extract_job", { id }) });
    }
    if (EXTRACT_TERMINAL_STATUSES.includes(item.status)) {
      act("Remove", { danger: item.status === "Failed", onClick: () => invoke("remove_extract_job", { id }) });
    }
  } else {
    if (item.status === "Completed" && item.dest_path) {
      act("Open", { onClick: () => invoke("open_path_in_default_app", { path: item.dest_path }) });
    }
    if (item.status === "Paused") {
      act("Resume", { primary: true, onClick: () => invoke("resume_download", { id }) });
    }
    if (item.status === "Failed") {
      act("Retry", { primary: true, onClick: () => invoke("retry_download", { id }) });
    }
    if (["Queued", "Downloading", "Paused"].includes(item.status)) {
      act("Cancel", { danger: true, onClick: () => invoke("cancel_download", { id }) });
    }
    if (TERMINAL_STATUSES.includes(item.status)) {
      act("Remove", { danger: item.status === "Failed", onClick: () => removeDownload(item) });
    }
  }
  return acts;
}

// Renders one item as the hero block: a larger name, a thin progress
// rule with a pulsing nib, size/rate on the right.
function renderHero(els, item) {
  if (els.mode !== "hero") {
    els.wrap.className = "hero";
    els.desc.className = "desc";
    els.amt.className = "amt";
    els.desc.replaceChildren();
    els.amt.replaceChildren();
    const kicker = document.createElement("div");
    kicker.className = "kicker";
    kicker.textContent = "Now fetching";
    const name = document.createElement("div");
    name.className = "name";
    const ruleOuter = document.createElement("div");
    ruleOuter.className = "rule-outer";
    const ruleFill = document.createElement("div");
    ruleFill.className = "rule-fill";
    ruleOuter.appendChild(ruleFill);
    els.desc.append(kicker, name, ruleOuter);
    const size = document.createElement("div");
    size.className = "size";
    const rate = document.createElement("div");
    rate.className = "rate";
    els.amt.append(size, rate);
    els.heroName = name;
    els.heroRuleOuter = ruleOuter;
    els.heroRuleFill = ruleFill;
    els.heroSize = size;
    els.heroRate = rate;
    els.mode = "hero";
  }
  els.currentItem = item;
  els.heroName.textContent = item.kind === "extract" ? item.title || item.source_url : item.filename;

  const pct = progressPercent(item);
  const speed = liveSpeedBytesPerSec(els, item.downloaded_bytes, true);
  els.heroRuleOuter.classList.toggle("indeterminate", pct == null);
  if (pct != null) els.heroRuleFill.style.width = `${pct}%`;

  els.heroSize.textContent =
    item.total_bytes != null
      ? `${formatBytes(item.downloaded_bytes)} of ${formatBytes(item.total_bytes)}`
      : formatBytes(item.downloaded_bytes);
  els.heroRate.textContent = speed != null ? `${formatBytes(speed)}/s` : "";
}

// --- Polling / list rendering ----------------------------------------------

let lastDownloads = [];
let lastExtractJobs = [];

async function refreshList() {
  let downloads = lastDownloads;
  let extractJobs = lastExtractJobs;
  try {
    downloads = (await invoke("list_downloads")) || [];
    lastDownloads = downloads;
  } catch (err) {
    console.error("Failed to list downloads:", err);
  }
  try {
    extractJobs = (await invoke("list_extract_jobs")) || [];
    lastExtractJobs = extractJobs;
  } catch (err) {
    console.error("Failed to list extract jobs:", err);
  }

  const items = [
    ...downloads.map((d) => ({ ...d, kind: "download" })),
    ...extractJobs.map((j) => ({ ...j, kind: "extract" })),
  ];

  for (const item of items) handleStatusTransition(item);

  const activeItems = items.filter((i) => i.status === "Downloading");
  const quietItems = items.filter((i) => i.status !== "Downloading");

  const isEmpty = items.length === 0;
  emptyStateEl.classList.toggle("hidden", !isEmpty);
  ledgerEl.classList.toggle("hidden", isEmpty);

  if (!isEmpty) {
    const frag = document.createDocumentFragment();
    if (activeItems.length > 0) {
      for (const item of activeItems) {
        const els = ensureRow(rowIdFor(item));
        renderHero(els, item);
        frag.append(els.wrap, els.unfold);
      }
      const spacer = document.createElement("div");
      spacer.className = "hero-spacer";
      frag.append(spacer);
    }
    for (const item of quietItems) {
      const els = ensureRow(rowIdFor(item));
      renderEntry(els, item);
      frag.append(els.wrap, els.unfold);
    }
    ledgerEl.replaceChildren(frag);
  }

  // Rows for ids no longer present get forgotten entirely -- nothing to
  // keep them alive for.
  const liveIds = new Set(items.map(rowIdFor));
  for (const id of Array.from(rowsById.keys())) {
    if (!liveIds.has(id)) {
      if (openUnfoldId === id) openUnfoldId = null;
      rowsById.delete(id);
    }
  }
}

// --- Auto-retry on failure (unchanged logic) -------------------------------

const autoReplantCounts = new Map();
const AUTO_REPLANT_MAX_ATTEMPTS = 3;

function handleStatusTransition(item) {
  const id = rowIdFor(item);
  const els = rowsById.get(id);
  const previousStatus = els?.lastStatus;
  if (els) els.lastStatus = item.status;

  if (item.status !== "Failed" || previousStatus === "Failed" || previousStatus == null) {
    if (item.status !== "Failed") autoReplantCounts.delete(id);
    if (item.status === "Completed" && previousStatus !== "Completed" && currentSettings.harvest_chime) {
      playCompletionChime();
    }
    return;
  }

  if (item.status === "Completed" && currentSettings.harvest_chime) playCompletionChime();

  if (currentSettings.auto_replant_failed) {
    const attempts = autoReplantCounts.get(id) ?? 0;
    if (attempts < AUTO_REPLANT_MAX_ATTEMPTS) {
      autoReplantCounts.set(id, attempts + 1);
      const command = item.kind === "extract" ? "retry_extract_job" : "retry_download";
      invoke(command, { id: item.id }).catch((err) => console.error(`${command} failed:`, err));
    }
  }
}

// Plays a short, soft two-tone notification chime via the Web Audio API --
// synthesized at runtime rather than shipping a sound asset. A plain sine
// tone with a gentle attack/decay.
function playCompletionChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [880, 1108].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.1;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.34);
    });
    setTimeout(() => ctx.close().catch(() => {}), 700);
  } catch (err) {
    // No Web Audio support, or the browser blocked it.
  }
}

// --- Add line ---------------------------------------------------------------

const addFormEl = document.getElementById("add-form");
const addUrlEl = document.getElementById("add-url");
const addErrorEl = document.getElementById("add-error");

addFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = addUrlEl.value.trim();
  if (!url) return;
  addErrorEl.classList.add("hidden");
  try {
    await invoke("add_download", { url, filename: null });
    addUrlEl.value = "";
    await refreshList();
  } catch (err) {
    addErrorEl.textContent = typeof err === "string" ? err : "Couldn't add that link.";
    addErrorEl.classList.remove("hidden");
  }
});

// --- Settings page -----------------------------------------------------------

const settingsDownloadDirEl = document.getElementById("settings-download-dir");
const settingsMaxConcurrentEl = document.getElementById("settings-max-concurrent");
const settingsSpeedLimitEl = document.getElementById("settings-speed-limit");
const settingHarvestChimeEl = document.getElementById("setting-harvest-chime");
const settingAutoReplantEl = document.getElementById("setting-auto-replant");
const settingStartWithSeasonEl = document.getElementById("setting-start-with-season");
const settingsErrorEl = document.getElementById("settings-error");
const checkYtdlpUpdateBtn = document.getElementById("check-ytdlp-update-btn");
const ytdlpUpdateStatusEl = document.getElementById("ytdlp-update-status");
const allowNewPairingBtn = document.getElementById("allow-new-pairing-btn");
const pairedProfilesListEl = document.getElementById("paired-profiles-list");
const pairedProfilesEmptyEl = document.getElementById("paired-profiles-empty");

let currentSettings = { harvest_chime: true, auto_replant_failed: false, start_with_the_season: true };

async function saveSettingsField(partial) {
  const merged = { ...currentSettings, ...partial };
  try {
    await invoke("set_settings", { settings: merged });
    currentSettings = merged;
    settingsErrorEl.classList.add("hidden");
  } catch (err) {
    settingsErrorEl.textContent = typeof err === "string" ? err : "Couldn't save that.";
    settingsErrorEl.classList.remove("hidden");
  }
}

// A field's value swaps for a plain <input> in place when clicked, and
// commits on Enter/blur -- the only "form" this page has, and only for
// the two fields that are genuinely free text/numbers.
function makeInlineEditable(button, { getValue, parse, commit }) {
  button.addEventListener("click", () => {
    const input = document.createElement("input");
    input.className = "fval-input";
    input.value = getValue();
    button.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = async (apply) => {
      if (done) return;
      done = true;
      if (apply) {
        const parsed = parse(input.value);
        await commit(parsed);
      }
      input.replaceWith(button);
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      }
      if (event.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  });
}

makeInlineEditable(settingsMaxConcurrentEl, {
  getValue: () => String(currentSettings.max_concurrent),
  parse: (raw) => Math.max(1, parseInt(raw, 10) || 1),
  commit: async (value) => {
    await saveSettingsField({ max_concurrent: value });
    settingsMaxConcurrentEl.textContent = String(currentSettings.max_concurrent);
  },
});
makeInlineEditable(settingsSpeedLimitEl, {
  getValue: () =>
    currentSettings.default_speed_limit_bytes_per_sec != null
      ? String(currentSettings.default_speed_limit_bytes_per_sec)
      : "",
  parse: (raw) => parseSpeedLimit(raw),
  commit: async (value) => {
    await saveSettingsField({ default_speed_limit_bytes_per_sec: value });
    settingsSpeedLimitEl.textContent =
      currentSettings.default_speed_limit_bytes_per_sec != null
        ? `${formatBytes(currentSettings.default_speed_limit_bytes_per_sec)}/s`
        : "No limit";
  },
});

settingsDownloadDirEl.addEventListener("click", async () => {
  const picked = await invoke("pick_download_folder");
  if (!picked) return;
  await saveSettingsField({ download_dir: picked });
  settingsDownloadDirEl.textContent = currentSettings.download_dir;
});

function wireToggle(button, field) {
  button.addEventListener("click", async () => {
    await saveSettingsField({ [field]: !currentSettings[field] });
    renderToggle(button, currentSettings[field]);
  });
}
function renderToggle(button, on) {
  button.textContent = on ? "On" : "Off";
  button.classList.toggle("on", on);
}
wireToggle(settingHarvestChimeEl, "harvest_chime");
wireToggle(settingAutoReplantEl, "auto_replant_failed");
settingStartWithSeasonEl.addEventListener("click", async () => {
  const next = !currentSettings.start_with_the_season;
  try {
    await invoke("set_autostart", { enabled: next });
    await saveSettingsField({ start_with_the_season: next });
    renderToggle(settingStartWithSeasonEl, next);
  } catch (err) {
    settingsErrorEl.textContent = typeof err === "string" ? err : "Couldn't change that.";
    settingsErrorEl.classList.remove("hidden");
  }
});

checkYtdlpUpdateBtn.addEventListener("click", async () => {
  checkYtdlpUpdateBtn.disabled = true;
  ytdlpUpdateStatusEl.textContent = "Checking…";
  ytdlpUpdateStatusEl.classList.remove("error");
  try {
    const result = await invoke("check_ytdlp_update");
    ytdlpUpdateStatusEl.textContent = result;
  } catch (err) {
    ytdlpUpdateStatusEl.textContent = typeof err === "string" ? err : "Couldn't check for an update.";
    ytdlpUpdateStatusEl.classList.add("error");
  } finally {
    checkYtdlpUpdateBtn.disabled = false;
  }
});

function formatPairedAt(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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
      const field = document.createElement("div");
      field.className = "field";
      const label = document.createElement("div");
      label.className = "flabel";
      label.textContent = `Paired ${formatPairedAt(profile.paired_at)}`;
      const row = document.createElement("div");
      row.className = "profile-row";
      const name = document.createElement("button");
      name.type = "button";
      name.className = "fval";
      name.textContent = profile.label;
      makeInlineEditable(name, {
        getValue: () => profile.label,
        parse: (raw) => raw.trim(),
        commit: async (value) => {
          if (!value || value === profile.label) return;
          try {
            await invoke("rename_paired_profile", { id: profile.id, label: value });
            profile.label = value;
          } catch (err) {
            console.error("rename_paired_profile failed:", err);
          }
          name.textContent = profile.label;
        },
      });
      const forget = document.createElement("span");
      forget.className = "forget";
      forget.textContent = "Forget";
      forget.addEventListener("click", async (event) => {
        event.stopPropagation();
        const confirmed = window.confirm(
          `Forget "${profile.label}"? That browser will need to pair again before it can send downloads here.`,
        );
        if (!confirmed) return;
        try {
          await invoke("forget_paired_profile", { id: profile.id });
        } catch (err) {
          console.error("forget_paired_profile failed:", err);
        }
        await refreshPairedProfiles();
      });
      row.append(name, forget);
      field.append(label, row);
      return field;
    }),
  );
}

const ALLOW_PAIRING_IDLE_TEXT = "Allow for 2 minutes";
let pairingCountdownId = null;

function formatCountdown(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")} left`;
}
function startPairingCountdown(remainingSeconds) {
  if (pairingCountdownId != null) clearInterval(pairingCountdownId);
  let remaining = remainingSeconds;
  const tick = () => {
    if (remaining <= 0) {
      clearInterval(pairingCountdownId);
      pairingCountdownId = null;
      allowNewPairingBtn.textContent = ALLOW_PAIRING_IDLE_TEXT;
      allowNewPairingBtn.classList.remove("on");
      return;
    }
    allowNewPairingBtn.textContent = formatCountdown(remaining);
    allowNewPairingBtn.classList.add("on");
    remaining -= 1;
  };
  tick();
  pairingCountdownId = setInterval(tick, 1000);
}
allowNewPairingBtn.addEventListener("click", async () => {
  try {
    const seconds = await invoke("allow_new_pairing");
    startPairingCountdown(seconds);
  } catch (err) {
    console.error("allow_new_pairing failed:", err);
  }
});

async function refreshSettingsPage() {
  try {
    const settings = await invoke("get_settings");
    currentSettings = settings;
    settingsDownloadDirEl.textContent = settings.download_dir;
    settingsMaxConcurrentEl.textContent = String(settings.max_concurrent);
    settingsSpeedLimitEl.textContent =
      settings.default_speed_limit_bytes_per_sec != null
        ? `${formatBytes(settings.default_speed_limit_bytes_per_sec)}/s`
        : "No limit";
    renderToggle(settingHarvestChimeEl, settings.harvest_chime);
    renderToggle(settingAutoReplantEl, settings.auto_replant_failed);
    renderToggle(settingStartWithSeasonEl, settings.start_with_the_season);
    settingsErrorEl.classList.add("hidden");
  } catch (err) {
    console.error("Failed to load settings:", err);
  }

  await refreshPairedProfiles();
  try {
    const remaining = await invoke("pairing_mode_remaining_seconds");
    if (remaining != null && remaining > 0) startPairingCountdown(remaining);
    else {
      allowNewPairingBtn.textContent = ALLOW_PAIRING_IDLE_TEXT;
      allowNewPairingBtn.classList.remove("on");
    }
  } catch (err) {
    console.error("pairing_mode_remaining_seconds failed:", err);
  }
}

// --- Browser companion setup page -------------------------------------------

const setupOpenPageBtn = document.getElementById("setup-open-page-btn");
const setupPageStatusEl = document.getElementById("setup-page-status");
const setupOpenFolderBtn = document.getElementById("setup-open-folder-btn");
const browserSetupErrorEl = document.getElementById("browser-setup-error");

setupOpenPageBtn.addEventListener("click", async () => {
  try {
    const result = await invoke("open_extensions_page");
    setupPageStatusEl.textContent = result;
    setupPageStatusEl.classList.remove("error");
  } catch (err) {
    setupPageStatusEl.textContent = typeof err === "string" ? err : "Couldn't do that.";
    setupPageStatusEl.classList.add("error");
  }
});
setupOpenFolderBtn.addEventListener("click", async () => {
  try {
    await invoke("open_extension_folder");
    browserSetupErrorEl.classList.add("hidden");
  } catch (err) {
    browserSetupErrorEl.textContent = typeof err === "string" ? err : "Couldn't open that folder.";
    browserSetupErrorEl.classList.remove("hidden");
  }
});

// --- Startup ------------------------------------------------------------------

invoke("get_settings")
  .then((settings) => {
    currentSettings = settings;
  })
  .catch((err) => console.error("Failed to load settings:", err));

refreshList();
setInterval(refreshList, POLL_INTERVAL_MS);

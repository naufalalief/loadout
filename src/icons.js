// Icon markup for Loadout -- clean stroke-based line icons (24x24
// viewBox, `stroke="currentColor"`, no fill), not the pixel-grid cells
// this file used to export. Each icon is the inner markup of an <svg>:
// `renderIconInto` (app.js) sets it directly as the target <svg>'s
// innerHTML, and the element's own `color` (CSS) decides the icon's
// color -- ink-dim for neutral/file-type icons, the accent color for the
// app/download mark, set where each icon is used.

// The app/download mark: an arrow dropping into an open tray. Used
// everywhere the app's own icon appears (popup title bars, the Add
// Download hero, the Settings about footer, the empty state).
export const appIcon =
  '<path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>';

// Status-bar Settings button: a gear, not a wrench -- same neutral
// "settings" meaning, cleaner at small sizes than a wrench silhouette.
export const settingsIcon =
  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.6 1z"/>';

// File-type icons -- all one neutral color (set via the slot's own CSS
// `color`), no per-type hue variety.
export const discIcon = '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.4"/>';
export const zipIcon =
  '<path d="M4 7l2-3h12l2 3"/><rect x="4" y="7" width="16" height="13" rx="1.5"/><path d="M10 11h4v4h-4z"/>';
export const pdfIcon =
  '<path d="M6 2h9l3 3v17H6z"/><path d="M15 2v3h3"/><path d="M9 13h6M9 16h6M9 10h3"/>';
export const audioIcon =
  '<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="16" r="2"/>';
export const imgIcon =
  '<rect x="4" y="4" width="16" height="16" rx="1.5"/><circle cx="9" cy="10" r="1.5"/><path d="M5 17l5-5 4 4 2-2 3 3"/>';
export const docIcon =
  '<path d="M6 2h9l3 3v17H6z"/><path d="M15 2v3h3"/><path d="M9 11h6M9 14h6M9 17h4"/>';
export const exeIcon = '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 8l6 4-6 4z"/>';
// MP4 / video icon: a simple framed play button. Extract jobs always use
// this one regardless of their real extension.
export const filmIcon = '<rect x="3" y="5" width="18" height="13" rx="1.5"/><path d="M8 9l5 3-5 3z"/>';

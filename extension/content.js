// Content script: shows a hover-over "Download" button on candidate
// <video> elements and sends the extraction request to the background
// worker.
//
// The one rule every line of this file is written to protect: the URL
// sent for extraction must always reflect reality AT THE MOMENT OF THE
// CLICK, never a value captured earlier (when the button was shown, or
// when the page was first scanned). On an SPA site (YouTube chief among
// them) the page can navigate to a different video via pushState, with
// no full reload, between the moment a user hovers the player and the
// moment they click the button -- if the click handler used a URL
// resolved at hover time, the user would download the WRONG video. See
// resolveTargetUrl() below: it is called fresh, inline, inside the click
// handler itself, and never memoized anywhere.
(function () {
  const MIN_WIDTH_PX = 200;
  const MIN_HEIGHT_PX = 150;
  const MIN_DURATION_SECONDS = 3;
  const HIDE_DELAY_MS = 200;
  const LOCATION_POLL_MS = 1000;

  /**
   * All <video> elements on the page that are plausible "real" videos
   * worth offering a download button for, filtering out tiny/decorative
   * or hidden ones.
   *
   * A video whose duration isn't known yet (readyState hasn't reached
   * HAVE_METADATA, so `.duration` is still NaN) is kept rather than
   * filtered -- we'd rather briefly offer a button for a short video than
   * never offer one for a long video just because it hasn't finished
   * loading metadata yet.
   *
   * @returns {HTMLVideoElement[]}
   */
  function findCandidateVideos() {
    return Array.from(document.querySelectorAll('video')).filter((video) => {
      let rect;
      try {
        rect = video.getBoundingClientRect();
      } catch (err) {
        return false;
      }
      if (rect.width < MIN_WIDTH_PX || rect.height < MIN_HEIGHT_PX) {
        return false;
      }

      let style;
      try {
        style = window.getComputedStyle(video);
      } catch (err) {
        style = null;
      }
      if (style && (style.display === 'none' || style.visibility === 'hidden')) {
        return false;
      }

      // `duration` is NaN until enough metadata has loaded to know it --
      // Number.isFinite(NaN) is false, so an unknown duration falls
      // through this check and the video is kept, per the filter above.
      if (Number.isFinite(video.duration) && video.duration < MIN_DURATION_SECONDS) {
        return false;
      }

      return true;
    });
  }

  /**
   * The URL a download button click for `videoEl` should target, resolved
   * from live DOM/location state RIGHT NOW -- never cached, never
   * precomputed. Call this exactly once, synchronously, at the top of a
   * click handler; do not store its result anywhere that outlives the
   * click.
   *
   * Prefers the href of the nearest ancestor <a href> (common on listing/
   * thumbnail pages, where the video itself isn't "the page"); falls back
   * to the current page URL otherwise. Both `anchor.href` and
   * `window.location.href` are DOM properties that are already resolved
   * to absolute URLs by the browser, so no extra resolution step is
   * needed.
   *
   * @param {HTMLVideoElement} videoEl
   * @returns {string}
   */
  function resolveTargetUrl(videoEl) {
    const anchor = videoEl.closest && videoEl.closest('a[href]');
    if (anchor && anchor.href) {
      return anchor.href;
    }
    return window.location.href;
  }

  // --- Overlay button -------------------------------------------------
  //
  // One shared shadow-DOM button, repositioned/shown over whichever
  // candidate video is currently hovered, rather than one button per
  // video -- simpler to keep in sync and there's only ever one button
  // visible at a time anyway.

  // LOADOUT app-icon cell data (pot + sprout), ported as a static literal
  // from src/icons.js's `appCells` (= `potCells.concat(plantCells)`,
  // generated there by `buildIcon`). The icon never changes, and content
  // scripts can't `import` from the main app's src/ (no shared module
  // boundary between the two packages), so the already-computed cells are
  // duplicated here rather than re-running buildIcon at runtime. Keep this
  // in sync with src/icons.js's `appCells` if that shape ever changes.
  const APP_CELLS = [
    { x: 3, y: 8, fill: '#e8a878' },
    { x: 4, y: 8, fill: '#c9793e' },
    { x: 5, y: 8, fill: '#c9793e' },
    { x: 6, y: 8, fill: '#c9793e' },
    { x: 7, y: 8, fill: '#c9793e' },
    { x: 8, y: 8, fill: '#8a4f24' },
    { x: 3, y: 9, fill: '#e8a878' },
    { x: 4, y: 9, fill: '#c9793e' },
    { x: 5, y: 9, fill: '#c9793e' },
    { x: 6, y: 9, fill: '#c9793e' },
    { x: 7, y: 9, fill: '#c9793e' },
    { x: 8, y: 9, fill: '#8a4f24' },
    { x: 4, y: 10, fill: '#e8a878' },
    { x: 5, y: 10, fill: '#c9793e' },
    { x: 6, y: 10, fill: '#c9793e' },
    { x: 7, y: 10, fill: '#8a4f24' },
    { x: 2, y: 8, fill: '#3a2410' },
    { x: 3, y: 7, fill: '#3a2410' },
    { x: 4, y: 7, fill: '#3a2410' },
    { x: 5, y: 7, fill: '#3a2410' },
    { x: 6, y: 7, fill: '#3a2410' },
    { x: 7, y: 7, fill: '#3a2410' },
    { x: 9, y: 8, fill: '#3a2410' },
    { x: 8, y: 7, fill: '#3a2410' },
    { x: 2, y: 9, fill: '#3a2410' },
    { x: 3, y: 10, fill: '#3a2410' },
    { x: 9, y: 9, fill: '#3a2410' },
    { x: 8, y: 10, fill: '#3a2410' },
    { x: 4, y: 11, fill: '#3a2410' },
    { x: 5, y: 11, fill: '#3a2410' },
    { x: 6, y: 11, fill: '#3a2410' },
    { x: 7, y: 11, fill: '#3a2410' },
    { x: 5, y: 4, fill: '#b8e89a' },
    { x: 6, y: 4, fill: '#2f6b22' },
    { x: 5, y: 5, fill: '#b8e89a' },
    { x: 6, y: 5, fill: '#2f6b22' },
    { x: 5, y: 6, fill: '#b8e89a' },
    { x: 6, y: 6, fill: '#2f6b22' },
    { x: 5, y: 7, fill: '#b8e89a' },
    { x: 6, y: 7, fill: '#2f6b22' },
    { x: 2, y: 3, fill: '#b8e89a' },
    { x: 3, y: 2, fill: '#b8e89a' },
    { x: 3, y: 3, fill: '#5aa83c' },
    { x: 4, y: 2, fill: '#5aa83c' },
    { x: 9, y: 3, fill: '#2f6b22' },
    { x: 8, y: 2, fill: '#2f6b22' },
    { x: 8, y: 3, fill: '#5aa83c' },
    { x: 7, y: 2, fill: '#5aa83c' },
    { x: 4, y: 4, fill: '#3a2410' },
    { x: 5, y: 3, fill: '#3a2410' },
    { x: 7, y: 4, fill: '#3a2410' },
    { x: 6, y: 3, fill: '#3a2410' },
    { x: 4, y: 5, fill: '#3a2410' },
    { x: 7, y: 5, fill: '#3a2410' },
    { x: 4, y: 6, fill: '#3a2410' },
    { x: 7, y: 6, fill: '#3a2410' },
    { x: 4, y: 7, fill: '#3a2410' },
    { x: 5, y: 8, fill: '#3a2410' },
    { x: 7, y: 7, fill: '#3a2410' },
    { x: 6, y: 8, fill: '#3a2410' },
    { x: 1, y: 3, fill: '#3a2410' },
    { x: 2, y: 4, fill: '#3a2410' },
    { x: 2, y: 2, fill: '#3a2410' },
    { x: 3, y: 1, fill: '#3a2410' },
    { x: 4, y: 3, fill: '#3a2410' },
    { x: 3, y: 4, fill: '#3a2410' },
    { x: 5, y: 2, fill: '#3a2410' },
    { x: 4, y: 1, fill: '#3a2410' },
    { x: 10, y: 3, fill: '#3a2410' },
    { x: 9, y: 4, fill: '#3a2410' },
    { x: 9, y: 2, fill: '#3a2410' },
    { x: 8, y: 1, fill: '#3a2410' },
    { x: 7, y: 3, fill: '#3a2410' },
    { x: 8, y: 4, fill: '#3a2410' },
    { x: 6, y: 2, fill: '#3a2410' },
    { x: 7, y: 1, fill: '#3a2410' },
  ];

  let overlayHost = null;
  let overlayButton = null;
  let overlayLabel = null;
  let currentVideo = null;
  let hideTimer = null;
  let pillFontsRegistered = false;

  // Chromium is widely reported to ignore @font-face rules declared inside
  // a shadow tree's own stylesheet -- font faces have to be registered at
  // the document/global level via the FontFace API and document.fonts,
  // which IS visible to shadow trees (including closed ones, like this
  // overlay's). Namespaced family names ('LOADOUT ...') avoid ever
  // colliding with a host page's own same-named font. Runs once; still
  // uses chrome.runtime.getURL() for the font file URLs, same as before.
  function registerPillFonts() {
    if (pillFontsRegistered) {
      return;
    }
    pillFontsRegistered = true;

    const fonts = [
      ['LOADOUT Press Start 2P', 'fonts/press-start-2p/PressStart2P-Regular.ttf'],
      ['LOADOUT VT323', 'fonts/vt323/VT323-Regular.ttf'],
    ];
    for (const [family, path] of fonts) {
      try {
        const face = new FontFace(family, `url('${chrome.runtime.getURL(path)}')`);
        face
          .load()
          .then((loadedFace) => {
            document.fonts.add(loadedFace);
          })
          .catch(() => {
            // Slow network, a strict CSP blocking the fetch, etc. -- the
            // pill's CSS falls back to a generic `monospace` after each
            // namespaced family name, so it still shows something readable
            // rather than silently falling back to a system default with
            // no pixel look at all.
          });
      } catch (err) {
        // FontFace construction itself threw (e.g. unsupported API) --
        // same fallback reasoning as above.
      }
    }
  }
  registerPillFonts();

  function ensureOverlay() {
    if (overlayHost) {
      return;
    }

    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.top = '0';
    host.style.left = '0';
    host.style.zIndex = '2147483647';
    host.style.display = 'none';
    // Never let the host's own box (even if some descendant miscomputes
    // size) capture clicks outside the button itself.
    host.style.pointerEvents = 'none';

    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host {
        --wood: #c98f4e;
        --cream: #fff8ea;
        --ink: #3a2410;
        --ink-dim: #8a6b42;
        --leaf: #5aa83c;
      }
      @keyframes popin {
        from { transform: scale(.8); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }
      .pill {
        /* No position/top/right here (unlike the spec mockup's static demo
           layout) -- this overlay's position is already fully driven by
           positionOverlayFor() via the fixed-position host div above, and
           a position:absolute offset on the pill itself would fight that
           existing, working tracking logic. */
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--cream);
        border: 2px solid var(--ink);
        padding: 8px 12px;
        box-shadow: 3px 3px 0 0 var(--ink);
        cursor: pointer;
        animation: popin .18s steps(4);
        transition: transform .1s ease, box-shadow .08s ease, filter .1s ease;
        /* The host above sets pointer-events: none so its own box never
           captures clicks outside the button; this opts the pill itself
           back in, same role the old plain button selector's rule played. */
        pointer-events: auto;
      }
      .pill:hover {
        filter: brightness(1.05);
      }
      .pill:active {
        transform: translate(2px, 2px);
        box-shadow: none;
      }
      .pill:disabled {
        opacity: 0.65;
        cursor: default;
      }
      .pill .sprite {
        image-rendering: pixelated;
        flex-shrink: 0;
      }
      .pill .label {
        font-family: 'LOADOUT Press Start 2P', monospace;
        font-size: 9px;
        color: var(--ink);
      }
    `;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pill';

    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('class', 'sprite');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 12 12');
    svg.setAttribute('shape-rendering', 'crispEdges');
    for (const cell of APP_CELLS) {
      const rect = document.createElementNS(svgNs, 'rect');
      rect.setAttribute('x', cell.x);
      rect.setAttribute('y', cell.y);
      rect.setAttribute('width', '1');
      rect.setAttribute('height', '1');
      rect.setAttribute('fill', cell.fill);
      svg.appendChild(rect);
    }

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'HARVEST';

    button.appendChild(svg);
    button.appendChild(label);

    button.addEventListener('mouseenter', cancelHide);
    button.addEventListener('mouseleave', scheduleHide);
    button.addEventListener('click', onButtonClick);

    shadow.appendChild(style);
    shadow.appendChild(button);

    (document.documentElement || document.body).appendChild(host);

    overlayHost = host;
    overlayButton = button;
    overlayLabel = label;
  }

  function positionOverlayFor(videoEl) {
    let rect;
    try {
      rect = videoEl.getBoundingClientRect();
    } catch (err) {
      return false;
    }
    if (rect.width === 0 && rect.height === 0) {
      // Detached or fully collapsed -- nothing sensible to position over.
      return false;
    }
    // `offsetWidth`/`offsetHeight`, not `getBoundingClientRect()` -- this
    // runs the instant `display` flips to `block`, which is also the
    // instant the pill's `popin` entrance animation starts, and
    // `getBoundingClientRect()` reflects the CSS `transform` that
    // animation is actively running (as small as `scale(.8)` right at the
    // start). That underestimates the button's real width by ~20%,
    // right-anchoring it too far right -- once the animation finishes at
    // `scale(1)` (its true size), the button overshoots past the video's
    // right edge by that same ~20%. `offsetWidth`/`offsetHeight` reflect
    // the untransformed layout box, unaffected by the animation.
    const buttonWidth = overlayButton.offsetWidth || 90;
    const buttonHeight = overlayButton.offsetHeight || 30;
    const margin = 8;
    let top = Math.max(rect.top + margin, 0);
    let left = Math.max(rect.right - margin - buttonWidth, rect.left + margin);
    // The clamps above only ever keep the button from going above/left of
    // the VIDEO's own box. They say nothing about the viewport: a video
    // whose own box extends past what's actually visible on screen
    // (theater mode, a narrow window, a page zoomed in) still computes a
    // position past the edge of the visible viewport, which is what put
    // the button outside the video in practice. Clamp against the
    // viewport too, same direction (never let it sit past the far edge).
    top = Math.min(top, window.innerHeight - buttonHeight);
    left = Math.min(left, window.innerWidth - buttonWidth);
    overlayHost.style.top = `${top}px`;
    overlayHost.style.left = `${left}px`;
    return true;
  }

  function showOverlayFor(videoEl) {
    ensureOverlay();
    cancelHide();
    currentVideo = videoEl;
    overlayHost.style.display = 'block';
    resetButtonLabel();
    // Position after display:block so getBoundingClientRect() on the
    // button (used for width) reflects its real rendered size.
    if (!positionOverlayFor(videoEl)) {
      hideOverlayNow();
    }
  }

  function resetButtonLabel() {
    if (!overlayButton || !overlayLabel) {
      return;
    }
    overlayButton.disabled = false;
    overlayLabel.textContent = 'HARVEST';
  }

  function hideOverlayNow() {
    cancelHide();
    if (overlayHost) {
      overlayHost.style.display = 'none';
    }
    currentVideo = null;
  }

  function cancelHide() {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function scheduleHide() {
    cancelHide();
    hideTimer = setTimeout(hideOverlayNow, HIDE_DELAY_MS);
  }

  /**
   * Whether `currentVideo` is still a trustworthy target to resolve a URL
   * from, checked at the moment of the click (never earlier). Being a
   * live DOM reference isn't enough on its own: a listing/carousel-style
   * SPA can swap which video sits under a stationary button via plain
   * DOM mutation, with no navigation and no mouseleave/mouseenter cycle
   * to make `rescan()` notice before the click lands, and a page scroll
   * while the pointer rests motionless on the (position:fixed) button can
   * carry a different video underneath it too. Both would otherwise
   * resolve a URL for content that's no longer what the button is
   * visually sitting on -- the same class of wrong-video bug this whole
   * phase exists to prevent, just via DOM mutation/scroll instead of a
   * URL change.
   *
   * Two independent checks, either of which failing means "no longer
   * trustworthy":
   * - `isConnected` -- catches the video having been removed from the
   *   document entirely.
   * - `document.elementsFromPoint()` at the button's current on-screen
   *   center still includes `currentVideo` -- catches both "a different
   *   video is now visually under the button" (node swap, no navigation)
   *   and "the page scrolled, so nothing/something else is under the
   *   button now" (scroll-while-hovering), without relying on `rescan()`
   *   having already run.
   *
   * @returns {boolean}
   */
  function isCurrentVideoStillValid() {
    if (!currentVideo || !currentVideo.isConnected || !overlayButton) {
      return false;
    }
    let buttonRect;
    try {
      buttonRect = overlayButton.getBoundingClientRect();
    } catch (err) {
      return false;
    }
    if (buttonRect.width === 0 && buttonRect.height === 0) {
      return false;
    }
    const x = buttonRect.left + buttonRect.width / 2;
    const y = buttonRect.top + buttonRect.height / 2;
    let stack;
    try {
      stack = document.elementsFromPoint(x, y);
    } catch (err) {
      // elementsFromPoint is broadly supported, but fail safe (treat as
      // untrustworthy) rather than assume validity if it ever throws.
      return false;
    }
    return stack.indexOf(currentVideo) !== -1;
  }

  /**
   * The button's click handler. This is the one place resolveTargetUrl()
   * must be called fresh -- see the file header comment. `currentVideo`
   * is only ever a plain DOM element reference (never a URL string), so
   * holding onto it between hover and click carries no staleness risk
   * from the URL side; what matters is that the URL is computed from it
   * right here, synchronously, before anything else happens, AND that
   * the reference itself is re-validated first (isCurrentVideoStillValid)
   * since the element it points to can stop being the right target
   * without the overlay ever being told (see that function's doc).
   */
  async function onButtonClick() {
    const videoEl = currentVideo;
    if (!videoEl || !isCurrentVideoStillValid()) {
      // The target under the button is no longer trustworthy -- hide and
      // send nothing. Falling through to resolve a URL from a reference
      // we just determined is wrong would reintroduce the exact bug this
      // file exists to prevent, just via a different trigger than a URL
      // change.
      hideOverlayNow();
      return;
    }

    // Resolved fresh, at the moment of the click -- never earlier.
    const pageUrl = resolveTargetUrl(videoEl);

    cancelHide();
    overlayButton.disabled = true;
    overlayLabel.textContent = 'Sending…';

    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: 'extractVideo', pageUrl });
    } catch (err) {
      // Extension context gone (e.g. reloaded) or no listener -- treat as
      // a plain failure, never throw out of a click handler.
      result = { ok: false };
    }

    overlayLabel.textContent = result && result.ok ? 'Sent' : 'Failed';
    setTimeout(() => {
      // Only reset if the button is still showing this transient state --
      // if the overlay moved on to a different video in the meantime,
      // leave it alone.
      if (overlayLabel && (overlayLabel.textContent === 'Sent' || overlayLabel.textContent === 'Failed')) {
        resetButtonLabel();
      }
    }, 1500);
  }

  // --- Tracking / rescan ------------------------------------------------
  //
  // Same reconciliation spirit as src/app.js's refreshList(): recompute
  // the current candidate set and add/remove hover tracking so it never
  // drifts from reality, instead of diffing or rebuilding from scratch.

  const trackedVideos = new Map(); // HTMLVideoElement -> {onEnter, onLeave}

  function attachTracking(video) {
    const onEnter = () => showOverlayFor(video);
    const onLeave = () => scheduleHide();
    video.addEventListener('mouseenter', onEnter);
    video.addEventListener('mouseleave', onLeave);
    trackedVideos.set(video, { onEnter, onLeave });
  }

  function detachTracking(video) {
    const handlers = trackedVideos.get(video);
    if (handlers) {
      video.removeEventListener('mouseenter', handlers.onEnter);
      video.removeEventListener('mouseleave', handlers.onLeave);
      trackedVideos.delete(video);
    }
    if (currentVideo === video) {
      hideOverlayNow();
    }
  }

  function rescan() {
    let candidates;
    try {
      candidates = new Set(findCandidateVideos());
    } catch (err) {
      candidates = new Set();
    }

    for (const video of candidates) {
      if (!trackedVideos.has(video)) {
        attachTracking(video);
      }
    }

    for (const video of Array.from(trackedVideos.keys())) {
      if (!candidates.has(video) || !document.contains(video)) {
        detachTracking(video);
      }
    }
  }

  // YouTube's own SPA-navigation signal -- fires on every client-side
  // navigation between watch pages, well before our 1s poll would notice.
  document.addEventListener('yt-navigate-finish', rescan);

  // Generic fallback for every other SPA that doesn't fire that event:
  // poll location.href and rescan whenever it changes. This only drives
  // *rescanning which videos have hover tracking* -- it is never the
  // source of truth for a click's target URL (see resolveTargetUrl()).
  let lastHref = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastHref) {
      lastHref = window.location.href;
      rescan();
    }
  }, LOCATION_POLL_MS);

  // DOM-mutation rescanning: a listing/carousel-style SPA can add,
  // remove, or swap <video> elements (or the ancestor chain around them)
  // with no navigation at all, which the yt-navigate-finish listener and
  // the location poll above can't see. Without this, (1) a video removed
  // or swapped out from under a stationary, already-visible button would
  // never get its hover tracking detached, and (2) videos that mount
  // after this script's initial document_idle scan (lazy-loaded feeds,
  // players that grow past the size filter later) would never get a
  // button at all. Debounced so a flurry of unrelated DOM churn on a
  // busy page rescans once, not once per mutation record.
  let mutationRescanTimer = null;
  const mutationObserver = new MutationObserver(() => {
    if (mutationRescanTimer !== null) {
      clearTimeout(mutationRescanTimer);
    }
    mutationRescanTimer = setTimeout(() => {
      mutationRescanTimer = null;
      rescan();
    }, 250);
  });
  try {
    mutationObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  } catch (err) {
    // If observation can't be started for some reason, rescanning still
    // happens via yt-navigate-finish and the location poll above -- just
    // without coverage for pure DOM-mutation changes until the next
    // navigation. The click-time isCurrentVideoStillValid() check still
    // protects against sending the wrong URL either way.
  }

  // Belt-and-suspenders for the moment between hovering and clicking: if
  // the page scrolls or the viewport resizes while a button is shown,
  // whatever was under the (position:fixed) button may no longer be --
  // hide immediately rather than let a stale-looking button sit there
  // until the next rescan. Capture phase because YouTube (and many other
  // SPAs) scroll an inner container, not `window`, and scroll events
  // don't bubble -- only capturing on `document` sees those too. The
  // click handler's isCurrentVideoStillValid() check is still the actual
  // safety net; this is just to avoid the UI looking misleadingly stale
  // in between.
  document.addEventListener(
    'scroll',
    () => {
      if (currentVideo) {
        hideOverlayNow();
      }
    },
    { capture: true, passive: true },
  );
  window.addEventListener('resize', () => {
    if (currentVideo) {
      hideOverlayNow();
    }
  });

  rescan();
})();

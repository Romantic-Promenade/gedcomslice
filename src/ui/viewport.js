// Zoom buttons, wheel/pinch zoom and scrollbars for a Cytoscape chart.

const PAD = 30; // room kept around the chart when scrolling to its edges
const STEP = 1.25; // zoom factor of one button press

/**
 * Where a scrollbar thumb sits on one axis, as fractions of the track.
 * `lo`/`hi` are the chart's edges and `view` the visible length, all in screen px
 * with the visible area starting at 0. Returns null when everything fits.
 */
export function scrollAxis(lo, hi, view, pad = PAD) {
  if (lo >= -1 && hi <= view + 1) return null;
  const start = Math.min(lo - pad, 0);
  const total = Math.max(hi + pad, view) - start;
  return { start: -start / total, size: view / total, total };
}

/** Zoom factor for a wheel event: pinch (sent as Ctrl+wheel) needs more gain than a mouse wheel. */
export function wheelFactor(e, viewHeight) {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewHeight : 1;
  const delta = Math.max(-100, Math.min(100, e.deltaY * unit));
  return Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015));
}

export function attachViewport(container, cy, { fit }, signal) {
  container.style.position = 'relative';

  const controls = document.createElement('div');
  controls.className = 'tree-controls';
  controls.innerHTML = `
    <button type="button" data-zoom="in" title="Zoom in" aria-label="Zoom in">+</button>
    <button type="button" data-zoom="reset" class="zoom-level" title="Actual size (100%)"></button>
    <button type="button" data-zoom="out" title="Zoom out" aria-label="Zoom out">−</button>
    <button type="button" data-zoom="fit" class="fit" title="Fit the whole tree" aria-label="Fit the whole tree">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg>
    </button>`;
  const level = controls.querySelector('.zoom-level');
  const zoomIn = controls.querySelector('[data-zoom="in"]');
  const zoomOut = controls.querySelector('[data-zoom="out"]');

  const bars = ['x', 'y'].map((axis) => {
    const track = document.createElement('div');
    track.className = `scrollbar scrollbar-${axis}`;
    track.hidden = true;
    const thumb = document.createElement('div');
    thumb.className = 'scroll-thumb';
    track.append(thumb);
    return { axis, track, thumb, info: null };
  });
  container.append(controls, ...bars.map((b) => b.track));

  const center = () => ({ x: container.clientWidth / 2, y: container.clientHeight / 2 });
  let goal = null; // where a running button zoom will end, so quick clicks add up
  const zoomBy = (factor, at = center(), animate = false) => {
    const from = goal ?? { zoom: cy.zoom(), pan: cy.pan() };
    cy.stop(true);
    goal = null;
    const zoom = Math.min(cy.maxZoom(), Math.max(cy.minZoom(), from.zoom * factor));
    // Keep the point under `at` in place.
    const k = zoom / from.zoom;
    const pan = { x: at.x - (at.x - from.pan.x) * k, y: at.y - (at.y - from.pan.y) * k };
    if (!animate) return cy.viewport({ zoom, pan });
    goal = { zoom, pan };
    cy.animate({ zoom, pan }, { duration: 150, complete: () => (goal = null) });
  };

  controls.addEventListener(
    'click',
    (e) => {
      const action = e.target.closest('[data-zoom]')?.dataset.zoom;
      if (action === 'in') zoomBy(STEP, undefined, true);
      else if (action === 'out') zoomBy(1 / STEP, undefined, true);
      else if (action === 'reset') zoomBy(1 / cy.zoom(), undefined, true);
      else if (action === 'fit') fit();
    },
    { signal },
  );

  // Our own overlays must not start a selection or a Cytoscape drag underneath.
  for (const el of [controls, ...bars.map((b) => b.track)]) {
    for (const type of ['mousedown', 'touchstart', 'dblclick'])
      el.addEventListener(type, (e) => e.stopPropagation(), { signal });
  }

  // Wheel and trackpad pinch (which browsers report as Ctrl+wheel) zoom at the pointer;
  // Shift+wheel scrolls sideways.
  container.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (e.shiftKey && !e.ctrlKey) {
        cy.panBy({ x: -(e.deltaX || e.deltaY), y: 0 });
        return;
      }
      const r = container.getBoundingClientRect();
      zoomBy(wheelFactor(e, r.height), { x: e.clientX - r.left, y: e.clientY - r.top });
    },
    { passive: false, signal },
  );

  // Safari reports trackpad pinch as gesture events instead.
  let gestureZoom = null;
  container.addEventListener(
    'gesturestart',
    (e) => {
      e.preventDefault();
      gestureZoom = cy.zoom();
    },
    { signal },
  );
  container.addEventListener(
    'gesturechange',
    (e) => {
      e.preventDefault();
      if (gestureZoom === null) return;
      const r = container.getBoundingClientRect();
      zoomBy((gestureZoom * e.scale) / cy.zoom(), { x: e.clientX - r.left, y: e.clientY - r.top });
    },
    { signal },
  );
  container.addEventListener('gestureend', () => (gestureZoom = null), { signal });

  // Scrollbars: drag the thumb, or click the track to move by a page.
  for (const bar of bars) {
    const horizontal = bar.axis === 'x';
    const trackLength = () => (horizontal ? bar.track.clientWidth : bar.track.clientHeight);
    const panAlong = (px) => cy.panBy(horizontal ? { x: px, y: 0 } : { x: 0, y: px });

    bar.thumb.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0 || !bar.info) return;
        e.preventDefault();
        e.stopPropagation();
        bar.thumb.setPointerCapture(e.pointerId);
        bar.track.classList.add('dragging');
        const ratio = bar.info.total / trackLength(); // chart px per track px
        let last = horizontal ? e.clientX : e.clientY;
        const move = (ev) => {
          const now = horizontal ? ev.clientX : ev.clientY;
          panAlong(-(now - last) * ratio);
          last = now;
        };
        const up = () => {
          bar.track.classList.remove('dragging');
          bar.thumb.removeEventListener('pointermove', move);
          bar.thumb.removeEventListener('pointerup', up);
          bar.thumb.removeEventListener('pointercancel', up);
        };
        bar.thumb.addEventListener('pointermove', move);
        bar.thumb.addEventListener('pointerup', up);
        bar.thumb.addEventListener('pointercancel', up);
      },
      { signal },
    );

    bar.track.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0 || e.target !== bar.track) return;
        const r = bar.thumb.getBoundingClientRect();
        const before = horizontal ? e.clientX < r.left : e.clientY < r.top;
        const page = 0.9 * (horizontal ? container.clientWidth : container.clientHeight);
        panAlong(before ? page : -page);
      },
      { signal },
    );
  }

  let frame = 0;
  const update = () => {
    frame = 0;
    if (cy.destroyed()) return;
    const zoom = cy.zoom();
    level.textContent = `${Math.round(zoom * 100)}%`;
    zoomIn.disabled = zoom >= cy.maxZoom() - 1e-9;
    zoomOut.disabled = zoom <= cy.minZoom() + 1e-9;

    const bb = cy.elements().renderedBoundingBox();
    const empty = cy.elements().empty();
    const view = { x: container.clientWidth, y: container.clientHeight };
    for (const bar of bars) {
      bar.info = empty ? null : scrollAxis(bb[`${bar.axis}1`], bb[`${bar.axis}2`], view[bar.axis]);
      bar.track.hidden = !bar.info;
      if (!bar.info) continue;
      const [pos, len] = bar.axis === 'x' ? ['left', 'width'] : ['top', 'height'];
      bar.thumb.style[pos] = `${bar.info.start * 100}%`;
      bar.thumb.style[len] = `${bar.info.size * 100}%`;
    }
    // Leave the corner free when both bars show.
    container.classList.toggle('both-scrollbars', bars.every((b) => b.info));
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  cy.on('viewport resize add remove layoutstop', schedule);
  signal.addEventListener('abort', () => cancelAnimationFrame(frame));
  schedule();

  return { zoomBy };
}

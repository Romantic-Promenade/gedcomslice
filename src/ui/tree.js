// Family tree chart with left-button rectangle selection, or panning in hand mode.
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { CARD, layoutFamilyTree } from '../gedcom/familyTree.js';
import { lifespan } from '../gedcom/model.js';
import { attachViewport } from './viewport.js';

cytoscape.use(dagre);

const FAMILY = 'fam:';
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const personData = (p) => {
  const years = lifespan(p);
  return { person: p.id, label: years ? `${p.name}\n${years}` : p.name, sex: p.sex };
};

// Everyone at once, laid out by dagre.
function allElements(model) {
  const els = [];
  for (const p of model.people.values()) els.push({ data: { id: p.id, ...personData(p) }, classes: 'person' });
  for (const f of model.families.values()) {
    const fid = FAMILY + f.id;
    els.push({ data: { id: fid }, classes: 'family' });
    for (const parent of [f.husb, f.wife]) {
      if (parent && model.people.has(parent)) els.push({ data: { source: parent, target: fid } });
    }
    for (const c of f.children) if (model.people.has(c)) els.push({ data: { source: fid, target: c } });
  }
  return els;
}

// The tree around one main person, with +/− buttons on the cards.
function familyElements(model, layout) {
  const els = [];
  for (const n of layout.nodes) {
    if (n.kind === 'family') {
      els.push({ data: { id: n.id }, position: { x: n.x, y: n.y }, classes: 'family' });
      continue;
    }
    const data = { id: n.id, ...personData(model.people.get(n.person)) };
    els.push({ data, position: { x: n.x, y: n.y }, classes: n.root ? 'person main' : 'person' });
    for (const [dir, state, dy] of [
      ['u', n.up, -CARD.h / 2],
      ['d', n.down, CARD.h / 2],
    ]) {
      if (!state) continue;
      els.push({
        data: { id: `t:${dir}:${n.key}`, key: n.key, dir, label: state === 'open' ? '−' : '+' },
        position: { x: n.x + CARD.w / 2 - 16, y: n.y + dy },
        classes: `toggle ${state}`,
      });
    }
  }
  for (const e of layout.edges) {
    const data = { source: e.source, target: e.target };
    if (e.turn !== undefined) data.turn = e.turn;
    els.push({ data, classes: e.couple ? 'couple' : '' });
  }
  return els;
}

function style() {
  return [
    {
      selector: 'node.person',
      style: {
        shape: 'round-rectangle',
        width: 150,
        height: 44,
        'background-color': css('--node-bg'),
        'border-width': 2,
        'border-color': css('--sex-u'),
        label: 'data(label)',
        color: css('--text'),
        'font-size': 12,
        'font-family': 'system-ui, sans-serif',
        'text-wrap': 'wrap',
        'text-max-width': 140,
        'text-valign': 'center',
        'text-halign': 'center',
      },
    },
    { selector: 'node.person[sex = "M"]', style: { 'border-color': css('--sex-m') } },
    { selector: 'node.person[sex = "F"]', style: { 'border-color': css('--sex-f') } },
    { selector: 'node.family', style: { width: 8, height: 8, 'background-color': css('--edge') } },
    {
      selector: 'edge',
      style: { width: 1.5, 'line-color': css('--edge'), 'curve-style': 'taxi', 'taxi-direction': 'vertical' },
    },
    { selector: 'edge.couple', style: { 'curve-style': 'straight' } },
    { selector: 'edge[turn]', style: { 'taxi-turn': 'data(turn)', 'taxi-turn-min-distance': 4 } },
    {
      selector: 'node.toggle',
      style: {
        shape: 'ellipse',
        width: 18,
        height: 18,
        'background-color': css('--node-bg'),
        'border-width': 1.5,
        'border-color': css('--edge'),
        label: 'data(label)',
        color: css('--text'),
        'font-size': 14,
        'font-weight': 'bold',
        'text-valign': 'center',
        'text-halign': 'center',
      },
    },
    { selector: 'node.toggle.closed', style: { 'border-color': css('--accent'), color: css('--accent') } },
    { selector: 'node.person.main', style: { 'border-width': 3, 'font-weight': 'bold' } },
    { selector: 'node.picked', style: { 'background-color': css('--accent'), color: css('--on-accent') } },
    { selector: 'node.active', style: { 'border-width': 4, 'border-color': css('--active') } },
    { selector: 'node.dim', style: { opacity: 0.35 } },
  ];
}

/**
 * @param {HTMLElement} container
 * @param {{ people: Map, families: Map }} model
 * @param {{
 *   onRect?: (ids: string[], mode: 'replace'|'add'|'remove') => void,
 *   onClick?: (id: string) => void,
 *   onDoubleClick?: (id: string) => void,
 * }} handlers
 *   Leave out the handlers for a read-only chart.
 * @param {{ kind: 'all' } | { kind: 'family', root: string, up: number, down: number }} view
 *   Everyone at once, or the tree around a main person.
 */
export function createTree(container, model, handlers = {}, view = { kind: 'all' }) {
  const interactive = Boolean(handlers.onRect);
  const cy = cytoscape({
    container,
    style: style(),
    userPanningEnabled: !interactive,
    userZoomingEnabled: false, // wheel, pinch and buttons are handled in viewport.js
    boxSelectionEnabled: false,
    autoungrabify: true,
    autounselectify: true,
    minZoom: 0.05,
    maxZoom: 3,
    wheelSensitivity: 0.3,
  });

  let selected = new Set();
  let active = null;
  let open = new Map(); // cards the user opened or closed, see layoutFamilyTree
  let truncated = false;

  const nodesOf = (id) => cy.nodes('.person').filter((n) => n.data('person') === id);
  const mark = () =>
    cy.batch(() => {
      cy.nodes('.person').forEach((n) => {
        n.toggleClass('picked', selected.has(n.data('person')));
        n.toggleClass('active', n.data('person') === active);
      });
    });

  // Redraw; `anchor` is a node id that should stay where it is on screen.
  const draw = (anchor) => {
    const before = anchor && cy.getElementById(anchor).renderedPosition();
    cy.batch(() => {
      cy.elements().remove();
      if (view.kind === 'family') {
        const layout = layoutFamilyTree(model, view.root, { up: view.up, down: view.down, open });
        truncated = layout.truncated;
        cy.add(familyElements(model, layout));
      } else {
        truncated = false;
        cy.add(allElements(model));
      }
    });
    if (view.kind === 'all') cy.layout({ name: 'dagre', rankDir: 'TB', nodeSep: 24, rankSep: 56, edgeSep: 10 }).run();
    mark();
    const after = before && cy.getElementById(anchor);
    if (after?.nonempty()) {
      const now = after.renderedPosition();
      cy.panBy({ x: before.x - now.x, y: before.y - now.y });
    }
  };
  draw();

  const toggle = (key, dir) => {
    const id = `${dir}:${key}`;
    const node = cy.getElementById(`t:${id}`);
    open.set(id, !node.hasClass('open'));
    draw(`n:${key}`);
  };

  const fit = () => cy.animate({ fit: { padding: 30 } }, { duration: 200 });
  const listeners = new AbortController();
  attachViewport(container, cy, { fit }, listeners.signal);
  if (interactive) attachMouse(container, cy, { ...handlers, onToggle: toggle }, listeners.signal);

  return {
    cy,
    get truncated() {
      return truncated;
    },
    /** Switch between everyone and the tree around a main person; opened cards are forgotten. */
    setView(next) {
      view = next;
      open = new Map();
      draw();
    },
    setSelection(next) {
      selected = next;
      mark();
    },
    setActive(id) {
      active = id ?? null;
      mark();
    },
    /** Whether the person is drawn now (not hidden in a closed branch). */
    has: (id) => nodesOf(id).nonempty(),
    focus(id) {
      const n = nodesOf(id);
      if (n.nonempty()) cy.animate({ center: { eles: n[0] }, zoom: Math.max(cy.zoom(), 0.8) }, { duration: 250 });
    },
    restyle() {
      cy.style(style());
    },
    fit: () => cy.fit(undefined, 30),
    destroy() {
      listeners.abort();
      cy.destroy();
      container.replaceChildren(); // our overlays
    },
  };
}

// Kept across files, so opening another GEDCOM stays in the mode the user picked.
let tool = 'select'; // 'select' | 'pan'

function attachMouse(container, cy, { onRect, onClick, onDoubleClick, onToggle }, signal) {
  const box = document.createElement('div');
  box.className = 'select-box';
  box.hidden = true;
  container.appendChild(box);

  // Mode switch above the zoom buttons: what a plain left-drag does.
  const modes = document.createElement('div');
  modes.className = 'tree-modes';
  modes.innerHTML = `
    <button type="button" data-tool="select" title="Select: drag to pick people" aria-label="Select mode">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path class="fill" d="M3.5 1.5v11.2l3-2.9 2 4.6 2-.9-2-4.5h4.2z" /></svg>
    </button>
    <button type="button" data-tool="pan" title="Hand: drag to move the tree" aria-label="Hand mode">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M5.5 8.5V3.2a1 1 0 0 1 2 0V7.5M7.5 7V2.2a1 1 0 0 1 2 0V7M9.5 7V3a1 1 0 0 1 2 0v4.5M11.5 7.5V5.2a1 1 0 0 1 2 0V10a5 5 0 0 1-5 5h-.8a4.5 4.5 0 0 1-3.4-1.6L1.9 10.6a1 1 0 0 1 1.5-1.3L5.5 11" />
      </svg>
    </button>`;
  container.querySelector('.tree-controls').prepend(modes);

  const setTool = (next) => {
    tool = next;
    container.classList.toggle('hand-mode', tool === 'pan');
    for (const b of modes.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', b.dataset.tool === tool);
  };
  modes.addEventListener(
    'click',
    (e) => {
      const next = e.target.closest('[data-tool]')?.dataset.tool;
      if (next) setTool(next);
    },
    { signal },
  );
  setTool(tool);

  let spaceDown = false;
  let drag = null; // { kind: 'select'|'pan', x0, y0, x, y, mode }

  const local = (e) => {
    const r = container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const nodesIn = (selector, x1, y1, x2, y2) =>
    cy.nodes(selector).filter((n) => {
      const b = n.renderedBoundingBox({ includeLabels: false });
      return b.x1 < x2 && b.x2 > x1 && b.y1 < y2 && b.y2 > y1;
    });
  // A person can be drawn twice (cousin marriages), so report each one once.
  const personsIn = (...box) => [...new Set(nodesIn('.person', ...box).map((n) => n.data('person')))];
  let lastClick = null; // { id, time } for double-clicks

  container.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });

  container.addEventListener(
    'mousedown',
    (e) => {
      if (e.target.closest('.tree-controls, .scrollbar')) return;
      const { x, y } = local(e);
      const pan = e.button === 1 || e.button === 2 || (e.button === 0 && (spaceDown || tool === 'pan'));
      if (!pan && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const mode = e.ctrlKey || e.metaKey ? 'remove' : e.shiftKey ? 'add' : 'replace';
      drag = { kind: pan ? 'pan' : 'select', x0: x, y0: y, x, y, mode };
      container.classList.toggle('panning', pan);
    },
    { capture: true, signal },
  );

  window.addEventListener(
    'mousemove',
    (e) => {
      if (!drag) return;
      const { x, y } = local(e);
      if (drag.kind === 'pan') {
        cy.panBy({ x: x - drag.x, y: y - drag.y });
      } else if (Math.abs(x - drag.x0) > 3 || Math.abs(y - drag.y0) > 3) {
        Object.assign(box.style, {
          left: `${Math.min(x, drag.x0)}px`,
          top: `${Math.min(y, drag.y0)}px`,
          width: `${Math.abs(x - drag.x0)}px`,
          height: `${Math.abs(y - drag.y0)}px`,
        });
        box.dataset.mode = drag.mode;
        box.hidden = false;
      }
      drag.x = x;
      drag.y = y;
    },
    { signal },
  );

  window.addEventListener(
    'mouseup',
    () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      container.classList.remove('panning');
      if (d.kind !== 'select') return;
      if (box.hidden) {
        const [t] = nodesIn('.toggle', d.x0, d.y0, d.x0 + 1, d.y0 + 1);
        if (t) return onToggle(t.data('key'), t.data('dir'));
        const [id] = personsIn(d.x0, d.y0, d.x0 + 1, d.y0 + 1);
        if (!id) return;
        onClick(id);
        // The two clicks of a double-click toggle the person on and off again,
        // so a double-click leaves the selection as it was.
        const now = Date.now();
        if (onDoubleClick && lastClick?.id === id && now - lastClick.time < 400) {
          lastClick = null;
          onDoubleClick(id);
        } else {
          lastClick = { id, time: now };
        }
        return;
      }
      box.hidden = true;
      onRect(personsIn(Math.min(d.x0, d.x), Math.min(d.y0, d.y), Math.max(d.x0, d.x), Math.max(d.y0, d.y)), d.mode);
    },
    { signal },
  );

  const isTyping = (e) => e.target.closest?.('input, textarea, select');
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.code === 'Space' && !isTyping(e)) {
        spaceDown = true;
        container.classList.add('can-pan');
        if (e.target === document.body) e.preventDefault();
      }
    },
    { signal },
  );
  window.addEventListener(
    'keyup',
    (e) => {
      if (e.code === 'Space') {
        spaceDown = false;
        container.classList.remove('can-pan');
      }
    },
    { signal },
  );
}

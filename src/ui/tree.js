// Family tree chart with left-button rectangle selection.
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { lifespan } from '../gedcom/model.js';

cytoscape.use(dagre);

const FAMILY = 'fam:';
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function elements(model) {
  const els = [];
  for (const p of model.people.values()) {
    const years = lifespan(p);
    els.push({ data: { id: p.id, label: years ? `${p.name}\n${years}` : p.name, sex: p.sex }, classes: 'person' });
  }
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
    { selector: 'node.picked', style: { 'background-color': css('--accent'), color: css('--on-accent') } },
    { selector: 'node.active', style: { 'border-width': 4, 'border-color': css('--active') } },
    { selector: 'node.dim', style: { opacity: 0.35 } },
  ];
}

/**
 * @param {HTMLElement} container
 * @param {{ people: Map, families: Map }} model
 * @param {{ onRect?: (ids: string[], mode: 'replace'|'add'|'remove') => void, onClick?: (id: string) => void }} handlers
 *   Leave out the handlers for a read-only chart.
 */
export function createTree(container, model, handlers = {}) {
  const interactive = Boolean(handlers.onRect);
  const cy = cytoscape({
    container,
    elements: elements(model),
    style: style(),
    layout: { name: 'dagre', rankDir: 'TB', nodeSep: 24, rankSep: 56, edgeSep: 10 },
    userPanningEnabled: !interactive,
    boxSelectionEnabled: false,
    autoungrabify: true,
    autounselectify: true,
    minZoom: 0.05,
    maxZoom: 3,
    wheelSensitivity: 0.3,
  });

  const listeners = new AbortController();
  if (interactive) attachMouse(container, cy, handlers, listeners.signal);

  return {
    cy,
    setSelection(selected) {
      cy.batch(() => cy.nodes('.person').forEach((n) => n.toggleClass('picked', selected.has(n.id()))));
    },
    setActive(id) {
      cy.nodes('.active').removeClass('active');
      const n = id && cy.getElementById(id);
      if (n && n.nonempty()) n.addClass('active');
    },
    focus(id) {
      const n = cy.getElementById(id);
      if (n.nonempty()) cy.animate({ center: { eles: n }, zoom: Math.max(cy.zoom(), 0.8) }, { duration: 250 });
    },
    restyle() {
      cy.style(style());
    },
    fit: () => cy.fit(undefined, 30),
    destroy() {
      listeners.abort();
      cy.destroy();
    },
  };
}

function attachMouse(container, cy, { onRect, onClick }, signal) {
  const box = document.createElement('div');
  box.className = 'select-box';
  box.hidden = true;
  container.style.position = 'relative';
  container.appendChild(box);

  let spaceDown = false;
  let drag = null; // { kind: 'select'|'pan', x0, y0, x, y, mode }

  const local = (e) => {
    const r = container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const personsIn = (x1, y1, x2, y2) =>
    cy
      .nodes('.person')
      .filter((n) => {
        const b = n.renderedBoundingBox({ includeLabels: false });
        return b.x1 < x2 && b.x2 > x1 && b.y1 < y2 && b.y2 > y1;
      })
      .map((n) => n.id());

  container.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });

  container.addEventListener(
    'mousedown',
    (e) => {
      const { x, y } = local(e);
      const pan = e.button === 1 || e.button === 2 || (e.button === 0 && spaceDown);
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
        const [id] = personsIn(d.x0, d.y0, d.x0 + 1, d.y0 + 1);
        if (id) onClick(id);
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

import './style.css';
import { decodeGedcom } from './gedcom/encoding.js';
import { buildModel } from './gedcom/model.js';
import { parseGedcom } from './gedcom/parse.js';
import { ancestors, descendants, immediateFamily } from './gedcom/relatives.js';
import { sliceGedcom } from './gedcom/slice.js';
import { createList } from './ui/list.js';
import { createTree } from './ui/tree.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  records: null,
  model: null,
  fileName: '',
  selected: new Set(),
  active: null,
  list: null,
  tree: null,
  previewTree: null,
  output: '',
  // What the tree shows; kept across files except for the main person.
  view: { kind: 'family', root: null, up: 3, down: 1 },
};

function setStatus(text) {
  $('#status').textContent = text;
}

function load(buffer, fileName) {
  const { text, encoding } = decodeGedcom(buffer);
  const { records, warnings } = parseGedcom(text);
  const model = buildModel(records);
  if (model.people.size === 0) {
    alert('No people (INDI records) found in this file. Is it a GEDCOM file?');
    return;
  }

  Object.assign(state, { records, model, fileName, selected: new Set(), active: null });
  $('#welcome').hidden = true;
  $('#workspace').hidden = false;
  $('#actionbar').hidden = false;
  $('#file-name').textContent = fileName;
  $('#search').value = '';

  state.list = createList($('#people tbody'), model, {
    onToggle: (id, on) => {
      const next = new Set(state.selected);
      on ? next.add(id) : next.delete(id);
      setSelection(next);
    },
    onActivate: (id) => {
      setActive(id);
      state.tree.focus(id);
    },
    onReveal: (id) => {
      setSelection(new Set([...state.selected, id]));
      if (!state.tree.reveal(id)) setMain(id);
      setActive(id);
      state.tree.focus(id, { maxZoom: 1 });
    },
  });

  state.view.root = model.people.keys().next().value;
  state.tree?.destroy();
  state.tree = createTree(
    $('#tree'),
    model,
    {
      onRect: (ids, mode) => {
        if (mode === 'replace') return setSelection(new Set(ids));
        const next = new Set(state.selected);
        for (const id of ids) mode === 'add' ? next.add(id) : next.delete(id);
        setSelection(next);
      },
      onClick: (id) => {
        const next = new Set(state.selected);
        next.has(id) ? next.delete(id) : next.add(id);
        setSelection(next);
        setActive(id);
      },
      onDoubleClick: (id) => setMain(id),
    },
    viewOf(state.view),
  );
  showView();
  state.tree.fit();

  setSelection(new Set());
  setActive(null);
  const note = warnings.length ? ` · ${warnings.length} unreadable lines skipped` : '';
  setStatus(`${model.people.size} people, ${model.families.size} families · ${encoding.toUpperCase()}${note}`);
  if (warnings.length) console.warn(warnings.join('\n'));
}

const viewOf = (v) => (v.kind === 'family' ? { ...v } : { kind: 'all' });

function showView() {
  const { view, model, tree } = state;
  for (const b of document.querySelectorAll('[data-view]'))
    b.setAttribute('aria-pressed', b.dataset.view === view.kind);
  for (const el of document.querySelectorAll('.family-only')) el.hidden = view.kind !== 'family';
  $('#main-name').textContent = model.people.get(view.root)?.name ?? '';
  $('#tree-note').hidden = !tree.truncated;
}

function changeView(patch) {
  Object.assign(state.view, patch);
  state.tree.setView(viewOf(state.view));
  showView();
  state.tree.fit();
}

function setMain(id) {
  if (!state.model.people.has(id)) return;
  changeView({ kind: 'family', root: id });
  setActive(id);
}

function setSelection(next) {
  state.selected = next;
  state.list.setSelection(next);
  state.tree.setSelection(next);
  $('#count').textContent = `${next.size} of ${state.model.people.size} selected`;
  $('#create-button').disabled = next.size === 0;
}

function setActive(id) {
  state.active = id ?? null;
  const p = id && state.model.people.get(id);
  $('#active-name').textContent = p ? p.name : 'click a name';
  for (const b of document.querySelectorAll('[data-helper], #main-button')) b.disabled = !p;
  state.list.setActive(id);
  state.tree.setActive(id);
}

function applyHelper(kind) {
  const { model, active } = state;
  if (!active) return;
  const withSpouses = $('#with-spouses').checked;
  const add =
    kind === 'ancestors'
      ? ancestors(model, active)
      : kind === 'descendants'
        ? descendants(model, active, { withSpouses })
        : immediateFamily(model, active);
  setSelection(new Set([...state.selected, ...add]));
}

function applyBulk(kind) {
  const all = [...state.model.people.keys()];
  if (kind === 'none') setSelection(new Set());
  if (kind === 'visible') setSelection(new Set([...state.selected, ...state.list.visibleIds()]));
  if (kind === 'invert') setSelection(new Set(all.filter((id) => !state.selected.has(id))));
}

function openPreview() {
  const { text, stats } = sliceGedcom(state.records, state.selected);
  state.output = text;
  const model = buildModel(parseGedcom(text).records);

  const extra = stats.other ? `, ${stats.other} sources, notes and other records` : '';
  $('#preview-stats').textContent = `${stats.people} people, ${stats.families} families${extra}.`;
  const base = state.fileName.replace(/\.(ged|gedcom)$/i, '') || 'tree';
  $('#out-name').value = `${base}-slice.ged`;

  const dialog = $('#preview');
  dialog.showModal();
  state.previewTree?.destroy();
  state.previewTree = createTree($('#preview-tree'), model);
  state.previewTree.fit();
}

function download() {
  let name = $('#out-name').value.trim() || 'slice.ged';
  if (!/\.ged$/i.test(name)) name += '.ged';
  const url = URL.createObjectURL(new Blob([state.output], { type: 'text/plain;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadFile(file) {
  if (file) load(await file.arrayBuffer(), file.name);
}

$('#file-input').addEventListener('change', (e) => {
  loadFile(e.target.files[0]);
  e.target.value = '';
});

$('#sample-button').addEventListener('click', async () => {
  const res = await fetch(`${import.meta.env.BASE_URL}sample.ged`);
  load(await res.arrayBuffer(), 'sample.ged');
});

for (const ev of ['dragover', 'drop']) {
  window.addEventListener(ev, (e) => {
    e.preventDefault();
    document.body.classList.toggle('dragging', ev === 'dragover');
    if (ev === 'drop') loadFile(e.dataTransfer.files[0]);
  });
}
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('dragging');
});

$('#search').addEventListener('input', (e) => state.list.filter(e.target.value));
for (const b of document.querySelectorAll('[data-helper]'))
  b.addEventListener('click', () => applyHelper(b.dataset.helper));
for (const b of document.querySelectorAll('[data-bulk]')) b.addEventListener('click', () => applyBulk(b.dataset.bulk));
$('#main-button').addEventListener('click', () => setMain(state.active));
for (const b of document.querySelectorAll('[data-view]'))
  b.addEventListener('click', () => changeView({ kind: b.dataset.view }));
for (const [sel, key] of [
  ['#gens-up', 'up'],
  ['#gens-down', 'down'],
]) {
  const select = $(sel);
  for (let n = 0; n <= 10; n++) select.add(new Option(n, n));
  select.add(new Option('all', 99));
  select.value = state.view[key];
  select.addEventListener('change', () => changeView({ [key]: Number(select.value) }));
}
$('#create-button').addEventListener('click', openPreview);
$('#download-button').addEventListener('click', download);

// Chart colours come from CSS variables, so redraw them when the theme changes.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  state.tree?.restyle();
  state.previewTree?.restyle();
});

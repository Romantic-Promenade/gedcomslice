// Searchable list of people with checkboxes.
import { lifespan } from '../gedcom/model.js';

const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * @param {HTMLTableSectionElement} tbody
 * @param {{ people: Map }} model
 * @param {{ onToggle: (id: string, on: boolean) => void, onActivate: (id: string) => void, onReveal?: (id: string) => void }} handlers
 */
export function createList(tbody, model, { onToggle, onActivate, onReveal }) {
  const rows = new Map();
  const sorted = [...model.people.values()].sort(
    (a, b) => a.surname.localeCompare(b.surname) || a.given.localeCompare(b.given) || a.birthYear - b.birthYear,
  );

  tbody.replaceChildren();
  for (const p of sorted) {
    const tr = document.createElement('tr');
    tr.dataset.id = p.id;
    tr.dataset.search = norm(`${p.name} ${p.id}`);
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.setAttribute('aria-label', `Select ${p.name}`);
    const cells = [box, p.name, lifespan(p), p.id.replace(/@/g, '')].map((content) => {
      const td = document.createElement('td');
      td.append(content);
      return td;
    });
    cells[1].className = 'name';
    cells[2].className = 'years';
    cells[3].className = 'xref';
    tr.append(...cells);
    tbody.append(tr);
    rows.set(p.id, { tr, box });
  }

  tbody.onchange = (e) => {
    if (e.target.type === 'checkbox') onToggle(e.target.closest('tr').dataset.id, e.target.checked);
  };
  tbody.onclick = (e) => {
    if (e.target.type !== 'checkbox') onActivate(e.target.closest('tr')?.dataset.id);
  };
  tbody.ondblclick = (e) => {
    const id = e.target.closest('tr')?.dataset.id;
    if (!id || e.target.type === 'checkbox' || !onReveal) return;
    getSelection()?.removeAllRanges(); // the double-click selected a word of the name
    onReveal(id);
  };

  return {
    setSelection(selected) {
      for (const [id, { tr, box }] of rows) {
        box.checked = selected.has(id);
        tr.classList.toggle('picked', box.checked);
      }
    },
    setActive(id) {
      for (const [rid, { tr }] of rows) tr.classList.toggle('active', rid === id);
      rows.get(id)?.tr.scrollIntoView({ block: 'nearest' });
    },
    filter(query) {
      const q = norm(query.trim());
      const shown = [];
      for (const [id, { tr }] of rows) {
        tr.hidden = q !== '' && !tr.dataset.search.includes(q);
        if (!tr.hidden) shown.push(id);
      }
      return shown;
    },
    visibleIds: () => [...rows].filter(([, { tr }]) => !tr.hidden).map(([id]) => id),
  };
}

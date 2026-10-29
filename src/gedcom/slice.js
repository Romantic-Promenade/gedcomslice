// Build a new GEDCOM that holds only the selected people.
import { child, isPointer, serializeGedcom } from './parse.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const gedDate = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

const node = (tag, value = '', kids = [], xref = null) => ({ tag, xref, value, children: kids, line: 0 });

/** Deep copy of a node without the subtrees for which drop(node) is true. */
function prune(n, drop) {
  return { ...n, children: n.children.filter((c) => !drop(c)).map((c) => prune(c, drop)) };
}

function forEachPointer(n, fn) {
  if (isPointer(n.value)) fn(n.value);
  for (const c of n.children) forEachPointer(c, fn);
}

function buildHeader(oldHead, date) {
  const version = (oldHead && child(child(oldHead, 'GEDC') ?? node(''), 'VERS')?.value) || '5.5.1';
  const v7 = version.startsWith('7');
  const gedc = node('GEDC', '', [node('VERS', version)]);
  if (!v7) gedc.children.push(node('FORM', 'LINEAGE-LINKED'));

  const head = node('HEAD', '', [gedc]);
  if (oldHead && v7) {
    const schema = child(oldHead, 'SCHMA');
    if (schema) head.children.push(schema);
  }
  if (!v7) head.children.push(node('CHAR', 'UTF-8'));
  head.children.push(node('SOUR', 'GEDCOMSLICE', [node('NAME', 'GedcomSlice'), node('VERS', '1.0')]));
  head.children.push(node('DATE', gedDate(date)));
  for (const tag of ['SUBM', 'LANG']) {
    const n = oldHead && child(oldHead, tag);
    if (n) head.children.push(node(tag, n.value));
  }
  return head;
}

/**
 * @param {import('./parse.js').GedNode[]} records  parsed source file
 * @param {Iterable<string>} selectedIds  INDI xrefs to keep
 * @returns {{ text: string, stats: { people: number, families: number, other: number } }}
 */
export function sliceGedcom(records, selectedIds, { date = new Date() } = {}) {
  const selected = new Set(selectedIds);
  const byXref = new Map(records.filter((r) => r.xref).map((r) => [r.xref, r]));
  const oldHead = records.find((r) => r.tag === 'HEAD');

  // A family stays when a selected partner is in it, or when it still links
  // at least two selected people (for example two siblings without parents).
  const keptFams = new Set();
  for (const r of records) {
    if (r.tag !== 'FAM' || !r.xref) continue;
    const members = r.children.filter((c) => ['HUSB', 'WIFE', 'CHIL'].includes(c.tag) && selected.has(c.value));
    const hasPartner = members.some((c) => c.tag !== 'CHIL');
    if (hasPartner || members.length >= 2) keptFams.add(r.xref);
  }

  const isKeptLink = (xref) => {
    const target = byXref.get(xref);
    if (!target) return true; // dangling in the source too; leave it as it was
    if (target.tag === 'INDI') return selected.has(xref);
    if (target.tag === 'FAM') return keptFams.has(xref);
    return true;
  };
  const dropLink = (n) => isPointer(n.value) && !isKeptLink(n.value);

  // People and families first, then every other record they point to
  // (sources, notes, media, repositories, submitters), followed transitively.
  const kept = new Map();
  const queue = [];
  const keep = (r) => {
    if (kept.has(r.xref)) return;
    const copy = prune(r, dropLink);
    kept.set(r.xref, copy);
    queue.push(copy);
  };
  for (const r of records) {
    if ((r.tag === 'INDI' && selected.has(r.xref)) || (r.tag === 'FAM' && keptFams.has(r.xref))) keep(r);
  }
  const head = buildHeader(oldHead, date);
  queue.push(head);
  while (queue.length) {
    forEachPointer(queue.shift(), (xref) => {
      const target = byXref.get(xref);
      if (target && target.tag !== 'INDI' && target.tag !== 'FAM') keep(target);
    });
  }

  // Keep the source file's record order.
  const body = records.filter((r) => r.xref && kept.has(r.xref)).map((r) => kept.get(r.xref));
  const text = serializeGedcom([head, ...body, node('TRLR')]);

  const people = body.filter((r) => r.tag === 'INDI').length;
  const families = body.filter((r) => r.tag === 'FAM').length;
  return { text, stats: { people, families, other: body.length - people - families } };
}

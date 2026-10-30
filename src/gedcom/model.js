// People and families extracted from parsed GEDCOM records.
import { child, children, isPointer } from './parse.js';

const yearOf = (date) => date?.match(/\b(\d{3,4})\b/)?.[1] ?? '';

function eventDate(indi, tags) {
  for (const tag of tags) {
    const ev = child(indi, tag);
    const date = ev && child(ev, 'DATE')?.value;
    if (date) return date;
  }
  return '';
}

function readName(indi) {
  const name = child(indi, 'NAME');
  if (!name) return { name: '(no name)', given: '', surname: '' };
  const raw = name.value;
  const surname = child(name, 'SURN')?.value ?? raw.match(/\/([^/]*)\//)?.[1]?.trim() ?? '';
  const given = child(name, 'GIVN')?.value ?? raw.split('/')[0].trim();
  const display = raw.replace(/\//g, ' ').replace(/\s+/g, ' ').trim();
  return { name: display || '(no name)', given, surname };
}

const pointers = (node, tag) =>
  children(node, tag)
    .map((c) => c.value)
    .filter(isPointer);

/**
 * @param {import('./parse.js').GedNode[]} records
 */
export function buildModel(records) {
  const people = new Map();
  const families = new Map();

  for (const r of records) {
    if (r.tag === 'INDI' && r.xref) {
      const birth = eventDate(r, ['BIRT', 'CHR', 'BAPM']);
      const death = eventDate(r, ['DEAT', 'BURI', 'CREM']);
      people.set(r.xref, {
        id: r.xref,
        ...readName(r),
        sex: child(r, 'SEX')?.value?.[0]?.toUpperCase() ?? 'U',
        birth,
        death,
        birthYear: yearOf(birth),
        deathYear: yearOf(death),
        famc: pointers(r, 'FAMC'),
        fams: pointers(r, 'FAMS'),
      });
    } else if (r.tag === 'FAM' && r.xref) {
      families.set(r.xref, {
        id: r.xref,
        husb: pointers(r, 'HUSB')[0] ?? null,
        wife: pointers(r, 'WIFE')[0] ?? null,
        children: pointers(r, 'CHIL'),
      });
    }
  }

  // Files often have only one side of a link (FAMS without HUSB, CHIL without
  // FAMC). Make both sides agree so the helpers and the chart see every link.
  for (const fam of families.values()) {
    for (const id of [fam.husb, fam.wife]) {
      const p = id && people.get(id);
      if (p && !p.fams.includes(fam.id)) p.fams.push(fam.id);
    }
    for (const id of fam.children) {
      const p = people.get(id);
      if (p && !p.famc.includes(fam.id)) p.famc.push(fam.id);
    }
  }
  for (const p of people.values()) {
    for (const fid of p.fams) {
      const fam = families.get(fid);
      if (!fam || fam.husb === p.id || fam.wife === p.id) continue;
      const slot = p.sex === 'F' ? (fam.wife ? 'husb' : 'wife') : fam.husb ? 'wife' : 'husb';
      if (!fam[slot]) fam[slot] = p.id;
    }
    for (const fid of p.famc) {
      const fam = families.get(fid);
      if (fam && !fam.children.includes(p.id)) fam.children.push(p.id);
    }
  }

  return { people, families };
}

export function lifespan(p) {
  if (!p.birthYear && !p.deathYear) return '';
  return `${p.birthYear || '?'}–${p.deathYear || ''}`;
}

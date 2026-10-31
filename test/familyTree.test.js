import { describe, expect, it } from 'vitest';
import { CARD, layoutFamilyTree } from '../src/gedcom/familyTree.js';

// A model like buildModel makes, from [id, sex] people and [id, husb, wife, children] families.
function makeModel(people, families) {
  const model = { people: new Map(), families: new Map() };
  for (const [id, sex] of people) model.people.set(id, { id, sex, famc: [], fams: [] });
  for (const [id, husb, wife, children] of families) {
    model.families.set(id, { id, husb, wife, children });
    for (const p of [husb, wife]) if (p) model.people.get(p).fams.push(id);
    for (const c of children) model.people.get(c).famc.push(id);
  }
  return model;
}

// Ten generations of ancestors above R, every couple also with a second child.
function bigModel() {
  const people = [['R', 'M']];
  const families = [];
  let n = 0;
  const addParents = (child, depth) => {
    if (depth === 0) return;
    const [f, m, sib] = [`P${n++}`, `P${n++}`, `P${n++}`];
    people.push([f, 'M'], [m, 'F'], [sib, 'F']);
    families.push([`F${n}`, f, m, [child, sib]]);
    addParents(f, depth - 1);
    addParents(m, depth - 1);
  };
  addParents('R', 6);
  // And descendants: two partners with two children each, four generations down.
  const addKids = (parent, depth) => {
    if (depth === 0) return;
    for (let i = 0; i < 2; i++) {
      const spouse = `S${n++}`;
      const kids = [0, 1].map(() => `K${n++}`);
      people.push([spouse, 'F'], ...kids.map((k) => [k, 'U']));
      families.push([`F${n}`, parent, spouse, kids]);
      for (const k of kids) addKids(k, depth - 1);
    }
  };
  addKids('R', 4);
  return makeModel(people, families);
}

const cards = (layout) => layout.nodes.filter((n) => n.kind === 'person');
const at = (layout, person) => cards(layout).find((n) => n.person === person);

function overlaps(layout) {
  const rows = new Map();
  for (const c of cards(layout))
    rows.set(
      c.y,
      [...(rows.get(c.y) ?? []), c.x].sort((a, b) => a - b),
    );
  const bad = [];
  for (const [y, xs] of rows) for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] < CARD.w) bad.push([y, xs[i]]);
  return bad;
}

describe('family tree layout', () => {
  const small = makeModel(
    [
      ['R', 'M'],
      ['D', 'M'],
      ['M', 'F'],
      ['GD', 'M'],
      ['GM', 'F'],
      ['W1', 'F'],
      ['W2', 'F'],
      ['C1', 'M'],
      ['C2', 'F'],
      ['C3', 'M'],
    ],
    [
      ['F1', 'D', 'M', ['R']],
      ['F2', 'GD', 'GM', ['D']],
      ['F3', 'R', 'W1', ['C1', 'C2']],
      ['F4', 'R', 'W2', ['C3']],
    ],
  );

  it('puts the father left and the mother right, with the family dot above the child', () => {
    const l = layoutFamilyTree(small, 'R');
    const [r, d, m] = ['R', 'D', 'M'].map((p) => at(l, p));
    expect(d.x).toBeLessThan(r.x);
    expect(m.x).toBeGreaterThan(r.x);
    expect(d.y).toBeLessThan(r.y);
    const dot = l.nodes.find((n) => n.id === 'n:r.P');
    expect(dot).toMatchObject({ x: r.x, y: d.y });
    expect(r).toMatchObject({ root: true, up: 'open', down: 'open' });
  });

  it('shows the first partner on the right, the second on the left, children below', () => {
    const l = layoutFamilyTree(small, 'R');
    const r = at(l, 'R');
    expect(at(l, 'W1').x).toBeGreaterThan(r.x);
    expect(at(l, 'W2').x).toBeLessThan(r.x);
    expect(at(l, 'C3').x).toBeLessThan(at(l, 'C1').x);
    for (const c of ['C1', 'C2', 'C3']) expect(at(l, c).y).toBeGreaterThan(r.y);
    expect(overlaps(l)).toEqual([]);
  });

  it('opens the default number of generations and follows the per-card overrides', () => {
    expect(at(layoutFamilyTree(small, 'R', { up: 1 }), 'GD')).toBeUndefined();
    expect(at(layoutFamilyTree(small, 'R', { up: 1 }), 'D').up).toBe('closed');
    const opened = layoutFamilyTree(small, 'R', { up: 1, open: new Map([['u:r.f', true]]) });
    expect(at(opened, 'GD')).toBeDefined();
    const closed = layoutFamilyTree(small, 'R', { open: new Map([['d:r', false]]) });
    expect(at(closed, 'C1')).toBeUndefined();
    expect(at(closed, 'W1')).toBeUndefined();
    expect(at(closed, 'R').down).toBe('closed');
  });

  it('never overlaps cards in a big, fully opened tree', () => {
    const l = layoutFamilyTree(bigModel(), 'R', { up: 99, down: 99 });
    expect(cards(l).length).toBeGreaterThan(300);
    expect(overlaps(l)).toEqual([]);
    expect(l.truncated).toBe(false);
  });

  it("shows the main person's brothers and sisters, and opens ancestors' ones on request", () => {
    const m = makeModel(
      [
        ['R', 'M'],
        ['B', 'M'],
        ['S', 'F'],
        ['D', 'M'],
        ['M', 'F'],
        ['U', 'M'],
        ['GD', 'M'],
        ['GM', 'F'],
      ],
      [
        ['F1', 'D', 'M', ['B', 'R', 'S']],
        ['F2', 'GD', 'GM', ['U', 'D']],
      ],
    );
    const l = layoutFamilyTree(m, 'R');
    expect(at(l, 'R')).toMatchObject({ sib: 'open', siblings: 2, side: -1 });
    // Both on the left of the main person, in birth order, joined to the parents' dot.
    expect(at(l, 'B').x).toBeLessThan(at(l, 'S').x);
    expect(at(l, 'S').x).toBeLessThan(at(l, 'R').x);
    expect(l.edges).toContainEqual(expect.objectContaining({ source: 'n:r.P', target: `n:${at(l, 'B').key}` }));
    // The father's brother is hidden at first, then goes on the father's outer (left) side.
    expect(at(l, 'D')).toMatchObject({ sib: 'closed', siblings: 1 });
    expect(at(l, 'U')).toBeUndefined();
    const opened = layoutFamilyTree(m, 'R', { open: new Map([['s:r.f', true]]) });
    expect(at(opened, 'U').x).toBeLessThan(at(opened, 'D').x);
    expect(overlaps(opened)).toEqual([]);
  });

  it('never overlaps cards with every brother, sister and child opened', () => {
    const model = bigModel();
    // Siblings: everyone in the ancestor families gets two children.
    for (const fam of model.families.values()) {
      if (fam.children.length !== 2 || !fam.children[1].startsWith('P')) continue;
      const extra = `X${fam.id}`;
      model.people.set(extra, { id: extra, sex: 'M', famc: [fam.id], fams: [] });
      fam.children.push(extra);
    }
    const open = new Map();
    let l;
    for (let round = 0; round < 12; round++) {
      l = layoutFamilyTree(model, 'R', { up: 4, down: 2, open });
      const closed = cards(l).flatMap((c) => [c.sib === 'closed' && `s:${c.key}`, c.down === 'closed' && `d:${c.key}`]);
      const fresh = closed.filter((k) => k && !open.has(k));
      if (!fresh.length) break;
      for (const k of fresh) open.set(k, true);
    }
    expect(cards(l).length).toBeGreaterThan(300);
    expect(overlaps(l)).toEqual([]);
  });

  it('stops at loops in broken files', () => {
    const loop = makeModel(
      [
        ['A', 'M'],
        ['B', 'F'],
      ],
      [['F1', 'A', 'B', ['A']]],
    );
    const l = layoutFamilyTree(loop, 'A', { up: 99, down: 99 });
    expect(cards(l).length).toBeLessThan(10);
  });
});

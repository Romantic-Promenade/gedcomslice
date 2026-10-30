// Layout of a FamilySearch-style tree around one main person: ancestors above
// (father left, mother right), spouses beside and children below. Each card can
// be opened or closed upwards (parents) and downwards (spouses and children).
// Pure geometry, no DOM, so the chart and the tests share it.

export const CARD = { w: 150, h: 44 };
const GAP = 24; // between neighbouring cards and subtrees
const COUPLE = 40; // between a person and their partner; the family dot sits in it
const ROW = 110; // between generations
const busY = (i) => CARD.h / 2 + 20 + 9 * Math.min(i, 4); // below the card centre
const MAX_CARDS = 4000; // stops runaway trees (cousin marriages over many generations)

const span = (lo, hi) => ({ lo, hi });
const union = (a, b) => span(Math.min(a.lo, b.lo), Math.max(a.hi, b.hi));
const shifted = (e, dx) => span(e.lo + dx, e.hi + dx);
const CARD_SPAN = span(-CARD.w / 2, CARD.w / 2);

const parentsOf = (model, id) => {
  const fam = model.families.get(model.people.get(id)?.famc[0]);
  const has = (p) => (p && model.people.has(p) ? p : null);
  return fam ? { father: has(fam.husb), mother: has(fam.wife) } : { father: null, mother: null };
};

const familiesOf = (model, id) =>
  (model.people.get(id)?.fams ?? [])
    .map((fid) => model.families.get(fid))
    .filter(Boolean)
    .map((fam) => ({
      spouse: [fam.husb, fam.wife].find((s) => s && s !== id && model.people.has(s)) ?? null,
      children: fam.children.filter((c) => model.people.has(c)),
    }));

/**
 * @param {{ people: Map, families: Map }} model
 * @param {string} root  xref of the main person
 * @param {{ up?: number, down?: number, open?: Map<string, boolean> }} options
 *   `up`/`down`: generations opened by default; `open`: per-card overrides keyed
 *   `u:<key>` or `d:<key>` (see the `key` of each card).
 * @returns {{ nodes: object[], edges: { source: string, target: string, couple?: boolean, turn?: number }[], truncated: boolean }}
 *   Person nodes: { id, key, kind: 'person', person, x, y, up, down } where up/down are
 *   'open', 'closed' or null (nothing to show). Family nodes: { id, kind: 'family', x, y }.
 */
export function layoutFamilyTree(model, root, { up = 3, down = 1, open = new Map() } = {}) {
  const nodes = [];
  const edges = [];
  let cards = 0;
  let truncated = false;

  const isOpen = (dir, key, depth) => open.get(`${dir}:${key}`) ?? depth < (dir === 'u' ? up : down);
  const room = () => {
    if (cards < MAX_CARDS) return true;
    truncated = true;
    return false;
  };

  // --- Ancestors: build a measured tree first, then place it.
  function measureUp(id, key, depth, path) {
    cards++;
    const { father, mother } = parentsOf(model, id);
    const can = Boolean(father || mother);
    const node = { id, key, up: can ? 'closed' : null, parents: [], ext: CARD_SPAN };
    if (!can || !isOpen('u', key, depth) || !room()) return node;
    node.up = 'open';
    const next = new Set(path).add(id);
    for (const [pid, tag] of [
      [father, 'f'],
      [mother, 'm'],
    ]) {
      if (pid && !next.has(pid)) node.parents.push(measureUp(pid, `${key}.${tag}`, depth + 1, next));
    }
    const [a, b] = node.parents;
    if (b) {
      // Push the two parent subtrees apart until they no longer overlap.
      node.d = Math.max((CARD.w + COUPLE) / 2, (a.ext.hi - b.ext.lo + GAP) / 2);
      node.ext = union(CARD_SPAN, union(shifted(a.ext, -node.d), shifted(b.ext, node.d)));
    } else if (a) {
      node.ext = union(CARD_SPAN, a.ext);
    }
    return node;
  }

  function placeUp(node, x, y, nodeId) {
    const [a, b] = node.parents;
    if (!a) return;
    const py = y - ROW;
    if (b) {
      const fx = x - node.d;
      const mx = x + node.d;
      const dot = `n:${node.key}.P`;
      pushPerson(a, fx, py, null);
      pushPerson(b, mx, py, null);
      nodes.push({ id: dot, kind: 'family', x, y: py });
      edges.push(
        { source: `n:${a.key}`, target: dot, couple: true },
        { source: `n:${b.key}`, target: dot, couple: true },
      );
      edges.push({ source: dot, target: nodeId });
      placeUp(a, fx, py, `n:${a.key}`);
      placeUp(b, mx, py, `n:${b.key}`);
    } else {
      pushPerson(a, x, py, null);
      edges.push({ source: `n:${a.key}`, target: nodeId });
      placeUp(a, x, py, `n:${a.key}`);
    }
  }

  // --- Descendants: same two passes, downwards.
  function measureDown(id, key, depth, path) {
    cards++;
    const fams = familiesOf(model, id);
    const node = { id, key, down: fams.length ? 'closed' : null, fams: [], ext: CARD_SPAN };
    if (!fams.length || !isOpen('d', key, depth) || !room()) return node;
    node.down = 'open';
    const next = new Set(path).add(id);
    const step = CARD.w + COUPLE;
    fams.forEach((f, i) => {
      // First partner on the right, second on the left, any others further right.
      const sx = f.spouse ? (i === 0 ? step : i === 1 ? -step : step * i) : 0;
      const beside = f.spouse && i < 2;
      const fam = {
        index: i,
        spouse: f.spouse,
        sx,
        // The children's bracket of each family runs at its own height so that
        // lines of different families never share a segment.
        bus: busY(i),
        dot: { x: f.spouse ? sx / 2 : 0, y: beside ? 0 : busY(i) - 10 },
        kids: f.children
          .filter((c) => !next.has(c))
          .map((c, j) => measureDown(c, `${key}.c${i}_${j}`, depth + 1, next)),
      };
      if (f.spouse) cards++;
      node.ext = union(node.ext, shifted(CARD_SPAN, sx));
      node.fams.push(fam);
    });

    // Children of each family side by side under their dot, groups left to right.
    let prevHi = -Infinity;
    for (const fam of [...node.fams].sort((p, q) => p.dot.x - q.dot.x)) {
      if (!fam.kids.length) continue;
      const widths = fam.kids.map((k) => k.ext.hi - k.ext.lo);
      const total = widths.reduce((s, w) => s + w, 0) + GAP * (fam.kids.length - 1);
      let left = Math.max(fam.dot.x - total / 2, prevHi + GAP);
      fam.kidX = fam.kids.map((k, j) => {
        const x = left - k.ext.lo;
        left += widths[j] + GAP;
        return x;
      });
      prevHi = left - GAP;
      fam.kids.forEach((k, j) => (node.ext = union(node.ext, shifted(k.ext, fam.kidX[j]))));
    }
    return node;
  }

  function placeDown(node, x, y) {
    const self = `n:${node.key}`;
    for (const fam of node.fams) {
      const dot = `n:${node.key}.F${fam.index}`;
      nodes.push({ id: dot, kind: 'family', x: x + fam.dot.x, y: y + fam.dot.y });
      const couple = fam.dot.y === 0; // dot beside the card: a straight line, else a bracket below
      edges.push({ source: self, target: dot, couple });
      if (fam.spouse) {
        const sid = `n:${node.key}.s${fam.index}`;
        nodes.push({
          id: sid,
          key: `${node.key}.s${fam.index}`,
          kind: 'person',
          person: fam.spouse,
          x: x + fam.sx,
          y,
          up: null,
          down: null,
        });
        edges.push({ source: sid, target: dot, couple });
      }
      fam.kids.forEach((k, j) => {
        const kx = x + fam.kidX[j];
        pushPerson(k, kx, y + ROW, null);
        edges.push({ source: dot, target: `n:${k.key}`, turn: fam.bus - fam.dot.y });
        placeDown(k, kx, y + ROW);
      });
    }
  }

  function pushPerson(m, x, y, extra) {
    nodes.push({
      id: `n:${m.key}`,
      key: m.key,
      kind: 'person',
      person: m.id,
      x,
      y,
      up: m.up ?? null,
      down: m.down ?? null,
      ...extra,
    });
  }

  if (!model.people.has(root)) return { nodes, edges, truncated };
  const upTree = measureUp(root, 'r', 0, new Set());
  const downTree = measureDown(root, 'r', 0, new Set());
  pushPerson(upTree, 0, 0, { down: downTree.down, root: true });
  placeUp(upTree, 0, 0, 'n:r');
  placeDown(downTree, 0, 0);
  return { nodes, edges, truncated };
}

// Layout of a FamilySearch-style tree around one main person: ancestors above
// (father left, mother right), spouses beside and children below. Each card can
// be opened or closed upwards (parents) and downwards (spouses and children), and
// the main person and their ancestors can show their brothers and sisters.
// Pure geometry, no DOM, so the chart and the tests share it.

export const CARD = { w: 150, h: 44 };
const GAP = 24; // between neighbouring cards and subtrees
const COUPLE = 40; // between a person and their partner; the family dot sits in it
const ROW = 110; // between generations
const busY = (i) => CARD.h / 2 + 20 + 9 * Math.min(i, 4); // below the card centre
const LINE_TURN = 30; // bracket from the parents' dot to a child and their brothers and sisters
const MAX_CARDS = 4000; // stops runaway trees (cousin marriages over many generations)

// A contour lists, for each row of a block (0 = the block's own card), the
// leftmost and rightmost x in use. Blocks are packed by their contours, so a
// branch only takes room on the rows where it actually has cards or lines.
const cardContour = (x = 0) => new Map([[0, { lo: x - CARD.w / 2, hi: x + CARD.w / 2 }]]);

function shift(c, dx, drow = 0) {
  const out = new Map();
  for (const [r, e] of c) out.set(r + drow, { lo: e.lo + dx, hi: e.hi + dx });
  return out;
}

function merge(...contours) {
  const out = new Map();
  for (const c of contours) {
    if (!c) continue;
    for (const [r, e] of c) {
      const o = out.get(r);
      out.set(r, o ? { lo: Math.min(o.lo, e.lo), hi: Math.max(o.hi, e.hi) } : { ...e });
    }
  }
  return out;
}

/** How far right `b` must move to clear `a` on every row both use (-Infinity if they share none). */
function clearance(a, b) {
  let d = -Infinity;
  for (const [r, e] of b) {
    const o = a.get(r);
    if (o) d = Math.max(d, o.hi - e.lo + GAP);
  }
  return d;
}

function widen(c, row, x) {
  const e = c.get(row);
  c.set(row, e ? { lo: Math.min(e.lo, x), hi: Math.max(e.hi, x) } : { lo: x, hi: x });
}

const parentFamily = (model, id) => model.families.get(model.people.get(id)?.famc[0]);

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
 *   `u:<key>` (parents), `d:<key>` (partners and children) or `s:<key>` (brothers
 *   and sisters), where `key` is the card's key.
 * @returns {{ nodes: object[], edges: { source: string, target: string, couple?: boolean, turn?: number }[], truncated: boolean }}
 *   Person nodes: { id, key, kind: 'person', person, x, y, up, down, sib, side, siblings }
 *   where up/down/sib are 'open', 'closed' or null (nothing to show), `side` is the
 *   side the brothers and sisters go to (-1 left, 1 right) and `siblings` their number.
 *   Family nodes: { id, kind: 'family', x, y }.
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
  const pushPerson = (person, key, x, y, extra) =>
    nodes.push({ id: `n:${key}`, key, kind: 'person', person, x, y, up: null, down: null, sib: null, ...extra });

  // A person with their partners beside them and their children below (rows >= 0).
  function measureDown(id, key, depth, path) {
    cards++;
    const fams = familiesOf(model, id);
    const state = fams.length ? (isOpen('d', key, depth) && room() ? 'open' : 'closed') : null;
    if (state !== 'open') {
      return { contour: cardContour(), draw: (x, y, card) => pushPerson(id, key, x, y, { down: state, ...card }) };
    }
    const next = new Set(path).add(id);
    const step = CARD.w + COUPLE;
    const groups = fams.map((f, i) => {
      if (f.spouse) cards++;
      // First partner on the right, second on the left, any others further right.
      const sx = f.spouse ? (i === 0 ? step : i === 1 ? -step : step * i) : 0;
      const beside = f.spouse && i < 2;
      return {
        index: i,
        spouse: f.spouse,
        sx,
        // The children's bracket of each family runs at its own height so that
        // lines of different families never share a segment.
        bus: busY(i),
        dot: { x: f.spouse ? sx / 2 : 0, y: beside ? 0 : busY(i) - 10 },
        kids: f.children
          .filter((c) => !next.has(c))
          .map((c, j) => ({ key: `${key}.c${i}_${j}`, ...measureDown(c, `${key}.c${i}_${j}`, depth + 1, next) })),
      };
    });

    // Children of each family packed side by side under their dot, families left to right.
    let below = new Map();
    for (const g of [...groups].sort((p, q) => p.dot.x - q.dot.x)) {
      if (!g.kids.length) continue;
      let packed = new Map();
      const xs = g.kids.map((k) => {
        const x = packed.size ? clearance(packed, k.contour) : 0;
        packed = merge(packed, shift(k.contour, x));
        return x;
      });
      const group = shift(packed, 0, 1);
      let dx = g.dot.x - (xs[0] + xs.at(-1)) / 2;
      dx += Math.max(0, clearance(below, shift(group, dx)));
      g.kidX = xs.map((x) => x + dx);
      below = merge(below, shift(group, dx));
      widen(below, 1, g.dot.x); // the bracket from the dot to the children
    }
    const contour = merge(cardContour(), ...groups.filter((g) => g.spouse).map((g) => cardContour(g.sx)), below);

    const draw = (x, y, card) => {
      pushPerson(id, key, x, y, { down: state, ...card });
      for (const g of groups) {
        const dot = `n:${key}.F${g.index}`;
        nodes.push({ id: dot, kind: 'family', x: x + g.dot.x, y: y + g.dot.y });
        const couple = g.dot.y === 0; // dot beside the card: a straight line, else a bracket below
        edges.push({ source: `n:${key}`, target: dot, couple });
        if (g.spouse) {
          pushPerson(g.spouse, `${key}.s${g.index}`, x + g.sx, y);
          edges.push({ source: `n:${key}.s${g.index}`, target: dot, couple });
        }
        g.kids.forEach((k, j) => {
          k.draw(x + g.kidX[j], y + ROW);
          edges.push({ source: dot, target: `n:${k.key}`, turn: g.bus - g.dot.y });
        });
      }
    };
    return { contour, draw };
  }

  // The main person or one of their ancestors: parents above, and brothers and
  // sisters beside them on `side`, away from their partner (father's left, mother's right).
  function measureLine(id, key, depth, path, side) {
    const isRoot = key === 'r';
    let base;
    if (isRoot) base = measureDown(id, key, 0, path);
    else {
      cards++;
      base = { contour: cardContour(), draw: (x, y, card) => pushPerson(id, key, x, y, card) };
    }
    const card = { side, ...(isRoot && { root: true }) };
    const fam = parentFamily(model, id);
    const next = new Set(path).add(id);
    const known = (p) => (p && model.people.has(p) && !next.has(p) ? p : null);
    const father = known(fam?.husb);
    const mother = known(fam?.wife);
    if (!father && !mother) return { contour: base.contour, draw: (x, y) => base.draw(x, y, card) };

    card.up = isOpen('u', key, depth) && room() ? 'open' : 'closed';
    const sibIds = fam.children.filter((c) => c !== id && model.people.has(c) && !next.has(c));
    if (card.up === 'closed') return { contour: base.contour, draw: (x, y) => base.draw(x, y, card) };

    let contour = base.contour;
    const sibs = [];
    if (sibIds.length) {
      card.siblings = sibIds.length;
      card.sib = (open.get(`s:${key}`) ?? isRoot) ? 'open' : 'closed'; // the main person's are open at first
    }
    if (card.sib === 'open') {
      // Nearest first, so that they read in birth order from left to right.
      for (const s of side < 0 ? [...sibIds].reverse() : sibIds) {
        const skey = `${key}.b${fam.children.indexOf(s)}`;
        const b = measureDown(s, skey, Infinity, next);
        const x = side < 0 ? -clearance(b.contour, contour) : clearance(contour, b.contour);
        contour = merge(contour, shift(b.contour, x));
        sibs.push({ key: skey, block: b, x });
      }
    }

    const F = father && measureLine(father, `${key}.f`, depth + 1, next, -1);
    const M = mother && measureLine(mother, `${key}.m`, depth + 1, next, 1);
    const Fc = F && shift(F.contour, 0, -1);
    const Mc = M && shift(M.contour, 0, -1);
    let fx = 0;
    let mx = 0;
    if (F && M) {
      // Push the two parents apart until their branches clear each other and this row.
      const d = Math.max((CARD.w + COUPLE) / 2, clearance(Fc, Mc) / 2, clearance(Fc, contour), clearance(contour, Mc));
      fx = -d;
      mx = d;
    } else if (F) fx = Math.min(0, -clearance(Fc, contour));
    else mx = Math.max(0, clearance(contour, Mc));
    contour = merge(contour, Fc && shift(Fc, fx), Mc && shift(Mc, mx));

    const draw = (x, y) => {
      base.draw(x, y, card);
      const py = y - ROW;
      let source;
      let turn = {}; // a bracket at its own height under a family dot
      if (F && M) {
        source = `n:${key}.P`;
        turn = { turn: LINE_TURN };
        nodes.push({ id: source, kind: 'family', x, y: py });
        F.draw(x + fx, py);
        M.draw(x + mx, py);
        edges.push(
          { source: `n:${key}.f`, target: source, couple: true },
          { source: `n:${key}.m`, target: source, couple: true },
        );
      } else {
        (F ?? M).draw(x + fx + mx, py);
        source = `n:${key}.${F ? 'f' : 'm'}`;
      }
      edges.push({ source, target: `n:${key}`, ...turn });
      for (const s of sibs) {
        s.block.draw(x + s.x, y);
        edges.push({ source, target: `n:${s.key}`, ...turn });
      }
    };
    return { contour, draw };
  }

  if (model.people.has(root)) measureLine(root, 'r', 0, new Set(), -1).draw(0, 0);
  return { nodes, edges, truncated };
}

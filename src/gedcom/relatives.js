// Relationship helpers used by "select ancestors / descendants / family".

const parentsOf = (model, id) => {
  const out = [];
  for (const fid of model.people.get(id)?.famc ?? []) {
    const fam = model.families.get(fid);
    if (fam?.husb) out.push(fam.husb);
    if (fam?.wife) out.push(fam.wife);
  }
  return out;
};

const spousesOf = (model, id) => {
  const out = [];
  for (const fid of model.people.get(id)?.fams ?? []) {
    const fam = model.families.get(fid);
    for (const s of [fam?.husb, fam?.wife]) if (s && s !== id) out.push(s);
  }
  return out;
};

const childrenOf = (model, id) =>
  (model.people.get(id)?.fams ?? []).flatMap((fid) => model.families.get(fid)?.children ?? []);

const siblingsOf = (model, id) =>
  (model.people.get(id)?.famc ?? []).flatMap((fid) => model.families.get(fid)?.children ?? []).filter((c) => c !== id);

function walk(start, next) {
  const seen = new Set();
  const queue = [...start];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...next(id));
  }
  return seen;
}

/** The person and all their ancestors. */
export const ancestors = (model, id) => walk([id], (x) => parentsOf(model, x));

/** The person and all their descendants, optionally with the descendants' spouses. */
export function descendants(model, id, { withSpouses = false } = {}) {
  const result = walk([id], (x) => childrenOf(model, x));
  if (withSpouses) for (const d of [...result]) for (const s of spousesOf(model, d)) result.add(s);
  return result;
}

/** The person, their parents, spouses, children and siblings. */
export const immediateFamily = (model, id) =>
  new Set([id, ...parentsOf(model, id), ...spousesOf(model, id), ...childrenOf(model, id), ...siblingsOf(model, id)]);

// Line-level GEDCOM parser. Every line becomes a node; nesting follows the
// level numbers. Nothing is interpreted here, so the file can be written back
// unchanged apart from what the slicer removes.

const LINE = /^\s*(\d+)\s+(?:(@[^@\s][^@]*@)\s+)?(\S+)(?: (.*))?$/;

/**
 * @typedef {{ tag: string, xref: string|null, value: string, children: GedNode[], line: number }} GedNode
 * @param {string} text
 * @returns {{ records: GedNode[], warnings: string[] }}
 */
export function parseGedcom(text) {
  const records = [];
  const warnings = [];
  const stack = []; // stack[level] = node at that level
  const lines = text.split(/\r\n|\r|\n/);

  lines.forEach((raw, i) => {
    if (raw.trim() === '') return;
    const m = raw.match(LINE);
    if (!m) {
      warnings.push(`Line ${i + 1}: cannot read "${raw.slice(0, 60)}"`);
      return;
    }
    const level = Number(m[1]);
    const node = { tag: m[3].toUpperCase(), xref: m[2] ?? null, value: m[4] ?? '', children: [], line: i + 1 };

    if (level === 0) {
      records.push(node);
    } else {
      const parent = stack[level - 1];
      if (!parent) {
        warnings.push(`Line ${i + 1}: level ${level} has no parent line, skipped`);
        return;
      }
      parent.children.push(node);
    }
    stack[level] = node;
    stack.length = level + 1;
  });

  return { records, warnings };
}

/** @param {GedNode[]} records */
export function serializeGedcom(records) {
  const out = [];
  const walk = (node, level) => {
    let line = String(level);
    if (node.xref) line += ' ' + node.xref;
    line += ' ' + node.tag;
    if (node.value !== '') line += ' ' + node.value;
    out.push(line);
    for (const child of node.children) walk(child, level + 1);
  };
  for (const r of records) walk(r, 0);
  return out.join('\n') + '\n';
}

export const isPointer = (value) => /^@[^@#\s][^@]*@$/.test(value);

export const child = (node, tag) => node.children.find((c) => c.tag === tag);
export const children = (node, tag) => node.children.filter((c) => c.tag === tag);

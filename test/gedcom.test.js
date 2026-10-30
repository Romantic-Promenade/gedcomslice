import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeAnsel, decodeGedcom } from '../src/gedcom/encoding.js';
import { buildModel } from '../src/gedcom/model.js';
import { parseGedcom, serializeGedcom } from '../src/gedcom/parse.js';
import { ancestors, descendants, immediateFamily } from '../src/gedcom/relatives.js';
import { sliceGedcom } from '../src/gedcom/slice.js';

const sampleText = readFileSync(new URL('../public/sample.ged', import.meta.url), 'utf8');
const { records } = parseGedcom(sampleText);
const model = buildModel(records);
const ids = (set) => [...set].sort();

describe('parse', () => {
  it('round-trips the sample file', () => {
    expect(serializeGedcom(records)).toBe(sampleText);
  });

  it('reports bad lines and orphan levels', () => {
    const { records: r, warnings } = parseGedcom('0 HEAD\nnonsense\n3 TAG x\n0 TRLR');
    expect(r.map((n) => n.tag)).toEqual(['HEAD', 'TRLR']);
    expect(warnings).toHaveLength(2);
  });
});

describe('encoding', () => {
  it('decodes ANSEL combining marks after the base letter', () => {
    // "Dąbrowska" -> ogonek (0xF1) before "a"; "Łódź" with acute before o and z
    const bytes = [0x44, 0xf1, 0x61, 0x62, 0x20, 0xa1, 0xe2, 0x6f, 0x64, 0xe2, 0x7a];
    expect(decodeAnsel(bytes)).toBe('Dąb Łódź');
  });

  it('uses the CHAR header', () => {
    const ansi = new Uint8Array([
      ...new TextEncoder().encode('0 HEAD\n1 CHAR ANSI\n0 @I1@ INDI\n1 NAME J'),
      0xf6,
      0x0a,
    ]);
    expect(decodeGedcom(ansi)).toMatchObject({ encoding: 'windows-1252', text: expect.stringContaining('Jö') });
    const utf8 = new TextEncoder().encode('﻿0 HEAD\n1 NAME Józef');
    expect(decodeGedcom(utf8)).toEqual({ encoding: 'utf-8', text: '0 HEAD\n1 NAME Józef' });
  });
});

describe('model and relatives', () => {
  it('reads people and families', () => {
    expect(model.people.size).toBe(25);
    expect(model.families.size).toBe(8);
    expect(model.people.get('@I5@')).toMatchObject({ name: 'Józef Kowalski', sex: 'M', birthYear: '1883' });
  });

  it('fills in one-sided links', () => {
    const m = buildModel(
      parseGedcom('0 @I1@ INDI\n1 SEX F\n1 FAMS @F1@\n0 @I2@ INDI\n0 @F1@ FAM\n1 CHIL @I2@').records,
    );
    expect(m.families.get('@F1@').wife).toBe('@I1@');
    expect(m.people.get('@I2@').famc).toEqual(['@F1@']);
  });

  it('finds ancestors, descendants and immediate family', () => {
    expect(ids(ancestors(model, '@I10@'))).toEqual(ids(['@I10@', '@I3@', '@I8@', '@I1@', '@I2@', '@I6@', '@I7@']));
    expect(ids(descendants(model, '@I10@'))).toEqual(ids(['@I10@', '@I19@', '@I20@', '@I24@', '@I25@']));
    expect(descendants(model, '@I10@', { withSpouses: true }).has('@I18@')).toBe(true);
    expect(ids(immediateFamily(model, '@I3@'))).toEqual(
      ids(['@I3@', '@I1@', '@I2@', '@I8@', '@I10@', '@I11@', '@I12@', '@I4@', '@I5@']),
    );
  });
});

describe('slice', () => {
  const date = new Date(2026, 9, 29);
  const cut = (sel) => {
    const out = sliceGedcom(records, sel, { date });
    return { ...out, parsed: parseGedcom(out.text).records, model: buildModel(parseGedcom(out.text).records) };
  };

  it('keeps only the selected people and prunes links', () => {
    const { model: m, stats, text } = cut(['@I1@', '@I2@', '@I3@']);
    expect([...m.people.keys()]).toEqual(['@I1@', '@I2@', '@I3@']);
    expect([...m.families.keys()]).toEqual(['@F1@', '@F3@']);
    expect(m.families.get('@F1@').children).toEqual(['@I3@']);
    expect(m.families.get('@F3@')).toMatchObject({ husb: '@I3@', wife: null, children: [] });
    expect(stats).toEqual({ people: 3, families: 2, other: 4 });
    expect(text).not.toMatch(/@I4@|@F2@|@F4@/);
  });

  it('keeps referenced sources, repositories, notes, media and submitter only', () => {
    const { parsed } = cut(['@I1@', '@I9@']);
    const xrefs = parsed.map((r) => r.xref).filter(Boolean);
    expect(xrefs).toEqual(expect.arrayContaining(['@U1@', '@S1@', '@R1@', '@N1@', '@O1@']));
    expect(xrefs).not.toContain('@S2@');
  });

  it('drops a family with only one selected child', () => {
    expect(cut(['@I24@']).stats.families).toBe(0);
    expect(cut(['@I24@', '@I25@']).stats.families).toBe(1);
  });

  it('writes a new header and trailer and leaves no dangling pointers', () => {
    const { text, parsed } = cut([...descendants(model, '@I3@')]);
    expect(
      text.startsWith('0 HEAD\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n1 SOUR GEDCOMSLICE'),
    ).toBe(true);
    expect(text).toContain('1 DATE 29 OCT 2026');
    expect(text.endsWith('0 TRLR\n')).toBe(true);
    const defined = new Set(parsed.map((r) => r.xref));
    for (const m of text.matchAll(/ (@[^@]+@)$/gm)) expect(defined.has(m[1])).toBe(true);
  });
});

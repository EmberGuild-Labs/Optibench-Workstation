/**
 * Every shipped example parses cleanly, round-trips, and its circuit is already in the
 * viewport's normal form as far as connectivity goes (normalizing never changes its nets).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from '../../src/core/project';
import { buildNetlist, circuitEngine } from '../../src/core/circuit';
import { defMap, normalizeScene } from '../../src/renderer/src/viewports/circuit/model';

const dir = path.resolve(__dirname, '../../examples');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.obw')).sort();
const defs = defMap(circuitEngine);

const nets = (s: Parameters<typeof buildNetlist>[0]): string => {
  const g: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(buildNetlist(s).pinNets)) (g[v] ??= []).push(k);
  return Object.values(g).map((a) => a.sort().join('+')).sort().join(' | ');
};

describe('examples', () => {
  it('ships at least 10 examples', () => expect(files.length).toBeGreaterThanOrEqual(10));
  for (const f of files) {
    it(`${f} parses without warnings, round-trips and keeps its nets under normalization`, () => {
      const { doc, warnings } = parseDocument(fs.readFileSync(path.join(dir, f), 'utf8'));
      expect(warnings).toEqual([]);
      expect(parseDocument(serializeDocument(doc)).doc).toEqual(doc);
      expect(nets(normalizeScene(doc.circuit, circuitEngine, defs))).toBe(nets(doc.circuit));
    });
  }
});

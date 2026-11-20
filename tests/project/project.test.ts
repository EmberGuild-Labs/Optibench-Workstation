import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument, serializeDocument, parseDocument, ProjectParseError, displayNameFromPath
} from '../../src/core/project';
import { FILE_MAGIC, FORMAT_VERSION } from '../../src/core/types';

describe('project document', () => {
  it('creates an empty document with defaults', () => {
    const d = createEmptyDocument('Bench');
    expect(d.format).toBe(FILE_MAGIC);
    expect(d.version).toBe(FORMAT_VERSION);
    expect(d.meta.title).toBe('Bench');
    expect(d.optics.components).toEqual([]);
    expect(d.links).toEqual([]);
  });

  it('round-trips through serialize/parse without warnings', () => {
    const d = createEmptyDocument('RT');
    d.optics.components.push({ id: 'o1', type: 'source.laser', position: { x: 1, y: 2 }, rotation: 0.5, props: { wavelength: 532, power: 0.01 } });
    d.circuit.components.push({ id: 'c1', type: 'opto.laser_diode', position: { x: 3, y: 4 }, rotation: 1, props: {} });
    d.circuit.wires.push({ id: 'w1', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }] });
    d.links.push({ id: 'l1', kind: 'emitter', circuitId: 'c1', opticsId: 'o1' });
    const text = serializeDocument(d);
    const { doc, warnings } = parseDocument(text);
    expect(warnings).toEqual([]);
    expect(doc).toEqual(d);
  });

  it('serializes with stable key order', () => {
    const d = createEmptyDocument('X');
    const a = serializeDocument(d);
    const b = serializeDocument(JSON.parse(a));
    expect(a).toBe(b);
    expect(a.indexOf('"format"')).toBeLessThan(a.indexOf('"meta"'));
    expect(a.endsWith('\n')).toBe(true);
  });

  it('rejects non-JSON and foreign files', () => {
    expect(() => parseDocument('{nope')).toThrow(ProjectParseError);
    expect(() => parseDocument('{"format":"other"}')).toThrow(/Not an Optibench/);
    expect(() => parseDocument('[]')).toThrow(ProjectParseError);
  });

  it('rejects newer format versions', () => {
    expect(() => parseDocument(JSON.stringify({ format: FILE_MAGIC, version: 999 }))).toThrow(/newer format/);
  });

  it('fills defaults and warns about invalid fields', () => {
    const { doc, warnings } = parseDocument(JSON.stringify({
      format: FILE_MAGIC, version: 1,
      meta: { title: 42 },
      optics: {
        settings: { maxBounces: -5 },
        components: [
          { id: 'a', type: 'lens.ideal', position: { x: 'q', y: 1 }, props: { f: 50, bad: {} } },
          { id: 'a', type: 'lens.ideal', position: { x: 0, y: 0 } },
          { position: { x: 0, y: 0 } }
        ]
      },
      circuit: { components: [{ id: 'r', type: 'passive.resistor', position: { x: 1.4, y: 2 }, rotation: 5 }], wires: [{ id: 'w', points: [{ x: 0, y: 0 }] }] },
      links: [{ id: 'l', kind: 'detector', circuitId: 'r', opticsId: 'missing' }, { kind: 'actuator', circuitId: 'r', opticsId: 'a' }],
      view: { activeTab: 'nope' }
    }));
    expect(doc.meta.title).toBe('Untitled Project');
    expect(doc.optics.settings.maxBounces).toBe(1);
    expect(doc.optics.settings.raysPerSource).toBeGreaterThan(0);
    expect(doc.optics.components.map((c) => c.id)).toEqual(['a', 'a_2']);
    expect(doc.optics.components[0].position).toEqual({ x: 0, y: 1 });
    expect(doc.optics.components[0].props).toEqual({ f: 50 });
    expect(doc.circuit.components[0].position).toEqual({ x: 1, y: 2 });
    expect(doc.circuit.components[0].rotation).toBe(1);
    expect(doc.circuit.wires).toEqual([]);
    expect(doc.links).toEqual([]);
    expect(doc.view?.activeTab).toBe('optics');
    expect(warnings.length).toBeGreaterThan(8);
  });

  it('migrates version 0 documents', () => {
    const { doc, warnings } = parseDocument(JSON.stringify({ format: FILE_MAGIC, version: 0, meta: { title: 'Old' } }));
    expect(doc.version).toBe(FORMAT_VERSION);
    expect(doc.links).toEqual([]);
    expect(warnings.some((w) => /Migrated/.test(w))).toBe(true);
  });

  it('strips BOM and derives display names', () => {
    const text = '\ufeff' + serializeDocument(createEmptyDocument('B'));
    expect(parseDocument(text).doc.meta.title).toBe('B');
    expect(displayNameFromPath('C:\\x\\My Bench.obw')).toBe('My Bench');
    expect(displayNameFromPath(null)).toBeNull();
  });
  it('preserves meta.dimension and optics pose3d through a round trip', () => {
    const d = createEmptyDocument('3D');
    d.meta.dimension = '3d';
    d.optics.components.push({ id: 'o1', type: 'mirror.flat', position: { x: 0, y: 0 }, rotation: 0, props: {}, pose3d: { z: 12.5, pitch: -10, roll: 45 } });
    d.optics.components.push({ id: 'o2', type: 'mirror.flat', position: { x: 5, y: 0 }, rotation: 0, props: {} });
    const { doc, warnings } = parseDocument(serializeDocument(d));
    expect(warnings).toEqual([]);
    expect(doc.meta.dimension).toBe('3d');
    expect(doc.optics.components[0].pose3d).toEqual({ z: 12.5, pitch: -10, roll: 45 });
    expect('pose3d' in doc.optics.components[1]).toBe(false);
    expect(doc).toEqual(d);
  });

  it('validates pose3d and meta.dimension', () => {
    const d = createEmptyDocument('bad');
    const raw = JSON.parse(serializeDocument(d));
    raw.meta.dimension = '4d';
    raw.optics.components = [
      { id: 'a', type: 'mirror.flat', position: { x: 0, y: 0 }, rotation: 0, props: {}, pose3d: { z: 'high', pitch: 5 } },
      { id: 'b', type: 'mirror.flat', position: { x: 0, y: 0 }, rotation: 0, props: {}, pose3d: 7 }
    ];
    const { doc, warnings } = parseDocument(JSON.stringify(raw));
    expect(doc.meta.dimension).toBe('2d');
    expect(doc.optics.components[0].pose3d).toEqual({ z: 0, pitch: 5, roll: 0 });
    expect(doc.optics.components[1].pose3d).toBeUndefined();
    expect(warnings.some((w) => w.includes('meta.dimension'))).toBe(true);
    expect(warnings.some((w) => w.includes('components[0].pose3d.z'))).toBe(true);
    expect(warnings.some((w) => w.includes('components[1].pose3d'))).toBe(true);
  });
});

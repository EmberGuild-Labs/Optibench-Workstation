// Integration QA: place one of every new circuit part (op-amp, comparator, regulator, 595, 138, H-bridge,
// motor, servo, thermistor, fuse, clock) on a fresh project, frame them, screenshot the circuit tab.
// Needs the QA hook: sh scripts/dev/relaunch.sh   (launches with --obw-qa)
// Run:              node scripts/dev/cdp.mjs run scripts/dev/qa/int-symbols.mjs
import fs from 'node:fs';
import path from 'node:path';

const TYPES = [
  ['ic.opamp', 'U1'], ['ic.comparator', 'U2'], ['ic.regulator', 'U3'], ['ic.hbridge', 'U4'],
  ['ic.shift595', 'U5'], ['ic.decoder138', 'U6'],
  ['misc.motor', 'MOT1'], ['misc.servo', 'SV1'], ['passive.thermistor', 'TH1'], ['passive.fuse', 'F1'], ['source.clock', 'CLK1']
];

export default async (api) => {
  const errs = await api.collect();
  const out = {};
  const shotDir = path.resolve('docs/screenshots');
  fs.mkdirSync(shotDir, { recursive: true });
  const placed = await api.eval(`(() => {
    const o = __obw, s = o.useApp.getState();
    s.loadDocument(o.project.createEmptyDocument(), null);
    const eng = o.engines.circuitEngine;
    const types = ${JSON.stringify(TYPES)};
    // grid: 4 columns, 12 grid units apart, 13 rows apart (the DIP ICs are 10 tall)
    const comps = types.map(([t, name], i) => {
      const c = eng.createComponent(t, { x: (i % 4) * 12, y: Math.floor(i / 4) * 13 });
      return { ...c, id: 'q' + i, name };
    });
    const d = o.useApp.getState().doc;
    o.useApp.getState().setCircuitScene({ ...d.circuit, components: comps, wires: [] }, true, 'QA place');
    o.useApp.getState().setTab('circuit');
    return comps.map((c) => c.type + '@' + c.position.x + ',' + c.position.y);
  })()`);
  out.placed = placed;
  await api.sleep(400);
  await api.eval(`__obw.commands.frameAll()`);
  await api.sleep(500);
  await api.shot(path.join(shotDir, 'int-new-symbols.png'));
  // running state (clock toggles, servo/motor idle) — a second shot for reference
  await api.key('F5');
  await api.sleep(1500);
  out.state = await api.eval(`(() => { const c = __obw.useSim.getState().circuit; if (!c) return null;
    return { t: c.time, conv: c.converged, err: c.error ?? null, clk: c.components.q10?.on, servo: c.components.q7?.angleDeg }; })()`);
  await api.shot(path.join(process.env.S, 'int-new-symbols-running.png'));
  await api.key('F5');
  out.count = await api.eval(`__obw.useApp.getState().doc.circuit.components.length`);
  out.errs = errs;
  return out;
};

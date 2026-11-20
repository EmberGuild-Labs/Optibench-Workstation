export default async (api) => {
  return api.eval(`(() => {
    const C = __obw.engines.circuitEngine;
    const doc = __obw.project.createEmptyDocument();
    const c = (t, x, y, id) => { const k = C.createComponent(t, {x, y}); k.id = id; return k; };
    doc.circuit.components = [c('passive.resistor', 3, -8, 'R1')];
    doc.circuit.components[0].rotation = 1;
    const pins = (s) => C.getPinPositions(s.components[0]).map(p => p.name + '@' + p.p.x + ',' + p.p.y).join(' ');
    const P = (x, y) => ({x, y});
    const pa = C.getPinPositions(doc.circuit.components[0]);
    doc.circuit.wires = [{id: 'w1', points: [P(-10, 0), P(-10, pa[0].p.y), pa[0].p]}, {id: 'w2', points: [pa[1].p, P(12, pa[1].p.y), P(12, 0)]}];
    const out = [pins(doc.circuit), JSON.stringify(doc.circuit.wires.map(w => w.points))];
    const n = __obw.circuitEdit.transformCircuit(doc.circuit, ['R1'], { rot: 1 });
    out.push(pins(n), JSON.stringify(n.wires.map(w => w.id + ':' + w.points.map(p => p.x + ',' + p.y).join(' '))));
    return out;
  })()`);
};

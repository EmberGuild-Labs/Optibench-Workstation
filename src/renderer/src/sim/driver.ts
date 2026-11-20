/**
 * Simulation driver.
 *  - Edit mode: optics is traced live in a Web Worker on every scene change (latest-wins debounce).
 *  - Running, no links: circuit simulator stepped on requestAnimationFrame; optics still via worker.
 *  - Running with OptoLinks: CoSimulator ticks circuit + optics together on the main thread.
 */
import type {
  CircuitScene, CircuitSimulator, CircuitState, ObwDocument, OpticsDrive, OpticsScene, ParamValue, TraceResult
} from '@core/types';
import { CoSimulator, type CoSimOptions } from '@core/cosim';
import { componentTimeTransmission, sourceTemporalEnvelope } from '@core/optics';
import { optics3dEngine } from '@core/optics3d';
import { circuitEngine, opticsEngine } from '../engines';
import { useApp } from '../store/app';
import { useSim } from '../store/sim';
import type { TraceRequest, TraceResponse } from '../workers/optics.worker';
import type { Trace3DRequest, Trace3DResponse } from '../workers/optics3d.worker';

/**
 * At slow-motion scales (< 1 µs of simulated time per second) the optics views draw pulses from the
 * segment times of flight themselves (lib/timeView.ts). The co-simulator would otherwise flash a
 * pulsed laser's source power tick by tick (zero between pulses), leaving nothing to draw, so its
 * envelope is reported as the average (1) there.
 */
export const SLOW_LIGHT_SCALE = 1e-6;
let slowLight = false;

/** Time-domain helpers handed to the co-simulator (chopper wheels, pulsed / modulated lasers). */
export const COSIM_TEMPORAL: NonNullable<CoSimOptions['temporal']> = {
  sourceTemporalEnvelope: (c, t) => (slowLight && c.props?.mode === 'pulsed' ? 1 : sourceTemporalEnvelope(c, t)),
  componentTimeTransmission
};

/** Debounce (ms) of 3D re-traces while editing (the 3D tracer is heavier than the 2D one). */
const TRACE3D_DEBOUNCE = 24;

type InteractAction = 'toggle' | 'press' | 'release' | { set: number };
type CoSimExt = CoSimulator;

const MAX_FRAME_DT = 1 / 20; // s of wall time per frame at most (avoid spiral after a stall)

function topologySignature(scene: CircuitScene): string {
  const parts: string[] = [];
  for (const c of scene.components) {
    let pins = '';
    try {
      pins = circuitEngine.getPinPositions(c).map((p) => `${p.name}@${p.p.x},${p.p.y}`).join(';');
    } catch {
      pins = `${c.position.x},${c.position.y},${c.rotation},${c.mirrored ? 1 : 0}`;
    }
    parts.push(`${c.id}|${c.type}|${pins}`);
  }
  for (const w of scene.wires) parts.push(`w:${w.id}|${w.points.map((p) => `${p.x},${p.y}`).join(';')}`);
  return parts.join('\n');
}

class SimDriver {
  private worker: Worker | null = null;
  private workerFailed = false;
  private busy = false;
  private reqId = 0;
  private sentAt = 0;
  private pendingScene: OpticsScene | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  private circuitSim: CircuitSimulator | null = null;
  private cosim: CoSimExt | null = null;
  private topoSig = '';
  private lastCircuit: CircuitScene | null = null;
  private lastOptics: OpticsScene | null = null;
  private lastLinksCount = 0;

  private raf = 0;
  private lastFrame = 0;
  /** Simulated seconds since Play from stopped / Reset (timeScale x wall time). */
  private simTime = 0;

  // 3D tracing (only while the optics workspace shows the 3D viewport)
  private worker3d: Worker | null = null;
  private worker3dFailed = false;
  private busy3d = false;
  private req3d = 0;
  private sent3dAt = 0;
  private pending3d: { scene: OpticsScene; drive?: OpticsDrive } | null = null;
  private timer3d: ReturnType<typeof setTimeout> | null = null;
  private last3dScene: OpticsScene | null = null;
  private unsub: (() => void) | null = null;
  private lastConverged = true;
  private lastError = '';

  start(): void {
    if (this.unsub) return;
    this.initWorker();
    let prevDoc: ObwDocument | null = useApp.getState().doc;
    let prevStatus = useApp.getState().sim.status;
    let prevDim = useApp.getState().opticsDim;
    if (prevDoc) this.onDoc(prevDoc, null);
    if (prevDim === '3d' && prevDoc) this.requestTrace3D(prevDoc.optics, undefined, true);
    this.unsub = useApp.subscribe((s) => {
      if (s.opticsDim !== prevDim) {
        prevDim = s.opticsDim;
        if (s.opticsDim === '3d' && s.doc) this.requestTrace3D(this.cosim ? this.cosim.scene : s.doc.optics, this.cosim?.lastDrive, true);
        else this.cancel3D();
      }
      if (s.doc !== prevDoc) {
        const old = prevDoc;
        prevDoc = s.doc;
        if (s.doc) this.onDoc(s.doc, old);
        else this.teardown();
      }
      if (s.sim.status !== prevStatus) {
        const was = prevStatus;
        prevStatus = s.sim.status;
        this.onStatus(s.sim.status, was);
      }
    });
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
    this.teardown();
    this.worker?.terminate();
    this.worker = null;
    this.worker3d?.terminate();
    this.worker3d = null;
  }

  // ------------------------------------------------------------------ 3D worker
  private initWorker3D(): boolean {
    if (this.worker3d) return true;
    if (this.worker3dFailed) return false;
    try {
      const w = new Worker(new URL('../workers/optics3d.worker.ts', import.meta.url), { type: 'module', name: 'optics3d-trace' });
      w.onmessage = (ev: MessageEvent<Trace3DResponse>) => this.onWorker3DMessage(ev.data);
      w.onerror = (ev) => {
        ev.preventDefault();
        this.worker3dFailed = true;
        this.worker3d?.terminate();
        this.worker3d = null;
        this.busy3d = false;
        useApp.getState().log('warn', 'optics3d', `3D optics worker failed (${ev.message || 'load error'}); tracing 3D on the main thread.`);
        if (this.last3dScene) this.requestTrace3D(this.last3dScene, undefined, true);
      };
      this.worker3d = w;
      return true;
    } catch (e) {
      this.worker3dFailed = true;
      useApp.getState().log('warn', 'optics3d', `3D optics worker unavailable (${(e as Error).message}); tracing 3D on the main thread.`);
      return false;
    }
  }

  private onWorker3DMessage(msg: Trace3DResponse): void {
    this.busy3d = false;
    if (msg.id === this.req3d && useApp.getState().opticsDim === '3d') {
      if (msg.ok) useSim.getState().set({ trace3d: msg.result, trace3dWallMs: performance.now() - this.sent3dAt });
      else useApp.getState().log('error', 'optics3d', `3D trace failed: ${msg.error}`);
    }
    if (this.pending3d && !this.timer3d) this.flush3D();
  }

  private cancel3D(): void {
    if (this.timer3d) clearTimeout(this.timer3d);
    this.timer3d = null;
    this.pending3d = null;
    this.req3d++; // drop in-flight results
    useSim.getState().set({ trace3d: null });
  }

  /** Latest-wins, debounced 3D trace request (no-op unless the 3D viewport is shown). */
  requestTrace3D(scene: OpticsScene, drive?: OpticsDrive, immediate = false): void {
    if (useApp.getState().opticsDim !== '3d') return;
    this.last3dScene = scene;
    this.pending3d = { scene, drive };
    if (this.timer3d) {
      if (!immediate) return;
      clearTimeout(this.timer3d);
      this.timer3d = null;
    }
    this.timer3d = setTimeout(() => { this.timer3d = null; this.flush3D(); }, immediate ? 0 : TRACE3D_DEBOUNCE);
  }

  private flush3D(): void {
    const job = this.pending3d;
    if (!job) return;
    if (this.initWorker3D() && this.worker3d) {
      if (this.busy3d) return; // sent when the in-flight trace returns
      this.pending3d = null;
      this.busy3d = true;
      this.sent3dAt = performance.now();
      const req: Trace3DRequest = { id: ++this.req3d, scene: job.scene, drive: job.drive };
      try {
        this.worker3d.postMessage(req);
      } catch (e) {
        this.busy3d = false;
        useApp.getState().log('error', 'optics3d', `Could not post scene to the 3D worker: ${(e as Error).message}`);
      }
      return;
    }
    this.pending3d = null;
    const t0 = performance.now();
    try {
      const r = optics3dEngine.trace3D(job.scene, job.drive);
      useSim.getState().set({ trace3d: { segments: r.segments, detectors: r.detectors, stats: r.stats }, trace3dWallMs: performance.now() - t0 });
    } catch (e) {
      useApp.getState().log('error', 'optics3d', `3D trace failed: ${(e as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ worker
  private initWorker(): void {
    if (this.worker || this.workerFailed) return;
    try {
      const w = new Worker(new URL('../workers/optics.worker.ts', import.meta.url), { type: 'module', name: 'optics-trace' });
      w.onmessage = (ev: MessageEvent<TraceResponse>) => this.onWorkerMessage(ev.data);
      w.onerror = (ev) => {
        ev.preventDefault();
        this.failWorker(`Optics worker failed (${ev.message || 'load error'}); tracing on the main thread.`);
      };
      this.worker = w;
    } catch (e) {
      this.failWorker(`Optics worker unavailable (${(e as Error).message}); tracing on the main thread.`);
    }
  }

  private failWorker(msg: string): void {
    this.workerFailed = true;
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    useApp.getState().log('warn', 'optics', msg);
    if (this.lastOptics) this.requestTrace(this.lastOptics);
  }

  private onWorkerMessage(msg: TraceResponse): void {
    this.busy = false;
    if (msg.id === this.reqId && !this.cosim) {
      if (msg.ok) {
        useSim.getState().set({ trace: msg.result, traceWallMs: performance.now() - this.sentAt, traceSource: 'worker' });
      } else {
        useApp.getState().log('error', 'optics', `Trace failed: ${msg.error}`);
      }
    }
    if (this.pendingScene) {
      const s = this.pendingScene;
      this.pendingScene = null;
      this.send(s);
    }
  }

  private send(scene: OpticsScene): void {
    this.busy = true;
    this.sentAt = performance.now();
    const req: TraceRequest = { id: ++this.reqId, scene };
    try {
      this.worker!.postMessage(req);
    } catch (e) {
      this.failWorker(`Could not post scene to optics worker: ${(e as Error).message}`);
    }
  }

  /** Latest-wins trace request for the edit-mode preview. */
  requestTrace(scene: OpticsScene): void {
    if (this.cosim) return; // co-simulation owns the optics trace while running
    if (this.worker) {
      if (this.busy) this.pendingScene = scene;
      else this.send(scene);
      return;
    }
    // main-thread fallback, coalesced to one trace per frame
    this.pendingScene = scene;
    if (this.fallbackTimer) return;
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = null;
      const s = this.pendingScene;
      this.pendingScene = null;
      if (!s || this.cosim) return;
      const t0 = performance.now();
      try {
        const trace = opticsEngine.trace(s);
        useSim.getState().set({ trace, traceWallMs: performance.now() - t0, traceSource: 'main' });
      } catch (e) {
        useApp.getState().log('error', 'optics', `Trace failed: ${(e as Error).message}`);
      }
    }, 16);
  }

  // ------------------------------------------------------------------ document
  private onDoc(doc: ObwDocument, old: ObwDocument | null): void {
    const opticsChanged = !old || doc.optics !== old.optics;
    const circuitChanged = !old || doc.circuit !== old.circuit;
    const linksChanged = !old || doc.links !== old.links;
    this.lastOptics = doc.optics;

    const running = this.circuitSim || this.cosim;
    if (running && linksChanged && (doc.links.length > 0) !== (this.lastLinksCount > 0)) {
      // switching between plain circuit sim and co-simulation
      this.createSimulators(doc);
      return;
    }
    if (this.cosim) {
      if (linksChanged || (circuitChanged && topologySignature(doc.circuit) !== this.topoSig)) {
        this.safe(() => this.cosim!.rebuild(doc));
        this.topoSig = topologySignature(doc.circuit);
      } else if (circuitChanged) {
        this.applyPropTweaks(doc.circuit, (id, props) => this.cosim!.updateCircuitProps(id, props));
      }
      if (opticsChanged) {
        this.safe(() => this.cosim!.setOpticsScene(doc.optics));
        this.requestTrace3D(doc.optics, this.cosim.lastDrive);
      }
      this.lastCircuit = doc.circuit;
      this.lastLinksCount = doc.links.length;
      return;
    }
    if (opticsChanged) {
      this.requestTrace(doc.optics);
      this.requestTrace3D(doc.optics);
    }
    if (this.circuitSim && circuitChanged) {
      const sig = topologySignature(doc.circuit);
      if (sig !== this.topoSig) {
        this.createSimulators(doc);
      } else {
        this.applyPropTweaks(doc.circuit, (id, props) => this.circuitSim!.updateProps(id, props));
      }
    }
    this.lastCircuit = doc.circuit;
    this.lastLinksCount = doc.links.length;
  }

  private applyPropTweaks(scene: CircuitScene, fn: (id: string, props: Record<string, ParamValue>) => void): void {
    const prev = new Map((this.lastCircuit?.components ?? []).map((c) => [c.id, c]));
    for (const c of scene.components) {
      const p = prev.get(c.id);
      if (p && p.props !== c.props) this.safe(() => fn(c.id, c.props));
    }
    if (this.lastCircuit && scene.settings !== this.lastCircuit.settings) {
      // timestep / gmin changes need a rebuild
      const a = scene.settings, b = this.lastCircuit.settings;
      if (a.timestep !== b.timestep || a.gmin !== b.gmin) {
        const doc = useApp.getState().doc;
        if (doc) this.createSimulators(doc);
      }
    }
  }

  // ------------------------------------------------------------------ run control
  private onStatus(status: string, was: string): void {
    const doc = useApp.getState().doc;
    if (!doc) return;
    if (status === 'running') {
      if (was === 'stopped' || (!this.circuitSim && !this.cosim)) {
        if (was === 'stopped') this.setSimTime(0);
        this.createSimulators(doc);
      }
      this.startLoop();
    } else if (status === 'paused') {
      this.stopLoop();
    } else {
      this.stopLoop();
      this.destroySimulators();
      useSim.getState().set({ circuit: null, drivenScene: null });
      this.setSimTime(0);
      this.requestTrace(doc.optics);
      this.requestTrace3D(doc.optics);
    }
  }

  private createSimulators(doc: ObwDocument): void {
    this.destroySimulators();
    this.lastConverged = true;
    this.lastError = '';
    this.topoSig = topologySignature(doc.circuit);
    this.lastCircuit = doc.circuit;
    this.lastLinksCount = doc.links.length;
    try {
      if (doc.links.length > 0) {
        this.cosim = new CoSimulator(doc, opticsEngine, circuitEngine, { temporal: COSIM_TEMPORAL });
      } else {
        this.circuitSim = circuitEngine.createSimulator(doc.circuit);
      }
    } catch (e) {
      useApp.getState().log('error', 'sim', `Could not build simulator: ${(e as Error).message}`);
      this.destroySimulators();
      useApp.getState().setSimStatus('stopped');
    }
  }

  private destroySimulators(): void {
    const hadCosim = !!this.cosim;
    this.circuitSim = null;
    this.cosim = null;
    if (hadCosim) useSim.getState().set({ drivenScene: null });
    if (hadCosim && this.lastOptics) {
      this.requestTrace(this.lastOptics);
      this.requestTrace3D(this.lastOptics);
    }
  }

  private teardown(): void {
    this.stopLoop();
    this.circuitSim = null;
    this.cosim = null;
    this.pendingScene = null;
    this.cancel3D();
    this.simTime = 0;
    useSim.getState().set({ circuit: null, trace: null, trace3d: null, drivenScene: null, time: 0 });
  }

  private startLoop(): void {
    if (this.raf) return;
    this.lastFrame = performance.now();
    const frame = (now: number): void => {
      this.raf = requestAnimationFrame(frame);
      const wall = Math.min(MAX_FRAME_DT, Math.max(0, (now - this.lastFrame) / 1000));
      this.lastFrame = now;
      this.advance(wall);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private advance(wallDt: number): void {
    const doc = useApp.getState().doc;
    if (!doc || wallDt <= 0) return;
    const scale = useApp.getState().timeScale;
    slowLight = scale < SLOW_LIGHT_SCALE;
    const dt = wallDt * (scale > 0 && Number.isFinite(scale) ? scale : 1);
    this.simTime += dt;
    let circuit: CircuitState | null = null;
    let trace: TraceResult | null = null;
    try {
      if (this.cosim) {
        const t0 = performance.now();
        const r = this.cosim.tick(dt);
        circuit = r.circuit;
        trace = r.trace;
        if (trace) {
          const ms = performance.now() - t0;
          // optics is traced on the UI thread while co-simulating: for heavy scenes keep tracing to
          // roughly a quarter of the frame budget so the UI stays responsive (drive keeps updating)
          this.cosim.minTraceInterval = Math.min(250, Math.max(0, ms * 3 - 8));
          // actuator-driven optics (servo / galvo rotations) are drawn from the driven copy
          const driven = Object.keys(r.rotations).length ? r.scene : null;
          useSim.getState().set({ circuit, trace, traceWallMs: ms, traceSource: 'cosim', drivenScene: driven, time: this.simTime });
          this.requestTrace3D(r.scene, r.drive);
        }
        else useSim.getState().set({ circuit, time: this.simTime });
      } else if (this.circuitSim) {
        circuit = this.circuitSim.step(dt);
        useSim.getState().set({ circuit, time: this.simTime });
      } else {
        useSim.getState().set({ time: this.simTime });
      }
    } catch (e) {
      useApp.getState().log('error', 'sim', `Simulation error: ${(e as Error).message}`);
      useApp.getState().setSimStatus('paused');
      return;
    }
    if (circuit) this.watchState(circuit);
  }

  private watchState(st: CircuitState): void {
    const log = useApp.getState().log;
    if (st.converged !== this.lastConverged) {
      this.lastConverged = st.converged;
      if (!st.converged) log('warn', 'circuit', `Solver did not converge at t = ${st.time.toPrecision(4)} s`);
      else log('info', 'circuit', 'Solver converged');
    }
    const err = st.error ?? '';
    if (err && err !== this.lastError) log('error', 'circuit', err);
    this.lastError = err;
  }

  /** Advance one frame (1/60 s of wall time scaled by sim speed); leaves the sim paused. */
  step(): void {
    const app = useApp.getState();
    const doc = app.doc;
    if (!doc) return;
    if (!this.circuitSim && !this.cosim) this.createSimulators(doc);
    if (app.sim.status === 'running') app.setSimStatus('paused');
    else if (app.sim.status === 'stopped') app.setSimStatus('paused');
    this.advance(1 / 60);
  }

  reset(): void {
    const app = useApp.getState();
    this.safe(() => this.cosim?.reset());
    this.safe(() => this.circuitSim?.reset());
    app.setSimStatus('stopped');
    this.setSimTime(0);
    useSim.getState().set({ circuit: null });
  }

  private setSimTime(t: number): void {
    this.simTime = t;
    useSim.getState().set({ time: t });
  }

  /** Simulated seconds since Play from stopped / Reset. */
  get time(): number {
    return this.simTime;
  }

  interact(id: string, action: InteractAction): void {
    if (this.cosim) this.safe(() => this.cosim!.interact(id, action));
    else if (this.circuitSim) this.safe(() => this.circuitSim!.interact(id, action));
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      useApp.getState().log('error', 'sim', (e as Error).message);
    }
  }
}

export const simDriver = new SimDriver();

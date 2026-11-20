import { useMemo } from 'react';
import type { DetectorReading, OpticalComponent } from '@core/types';
import type { DetectorReading3D } from '@core/types3d';
import { opticsDef, wavelengthRGB } from '../../engines';
import { formatSI } from '../../lib/units';
import { rgbCss } from '../../lib/spectrum';
import { useApp } from '../../store/app';
import { useSim } from '../../store/sim';
import { TypeGlyph } from '../Glyphs';
import { useCanvas } from './canvas';
import {
  RAD2DEG, ellipsePoints, formatLinewidth, fringeVisibility, handedness, imagePixels, linewidthHz, maxOf, poincareXY,
  profileStrip, wavelengthToTHz
} from './instrumentMath';

const NO_COMPONENTS: OpticalComponent[] = [];
type DetImage = NonNullable<DetectorReading3D['image']> & { widthMm?: number; heightMm?: number };
type Reading = DetectorReading & { image?: DetImage };

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function dBm(w: number): string {
  if (!(w > 0)) return '−∞ dBm';
  return `${(10 * Math.log10(w / 1e-3)).toFixed(1).replace('-', '−')} dBm`;
}

const AXIS_FONT = '10px "Lucida Console", Consolas, monospace';

function SpectrumChart({ spectrum, range }: { spectrum: number[]; range: [number, number] }): React.JSX.Element {
  const ref = useCanvas((g, w, h) => {
    const n = spectrum.length;
    if (!n) return;
    const pad = { l: 4, r: 4, t: 6, b: 16 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    const max = Math.max(maxOf(spectrum), 1e-30);
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = Math.round(pad.t + (ph * i) / 4) + 0.5;
      g.beginPath(); g.moveTo(pad.l, y); g.lineTo(pad.l + pw, y); g.stroke();
    }
    const [lo, hi] = range;
    const val = (i: number): number => (finite(spectrum[i]) ? Math.max(0, spectrum[i]) / max : 0);
    const xOf = (i: number): number => pad.l + (pw * (i + 0.5)) / n;
    for (let i = 0; i < n; i++) {
      const nm = lo + ((hi - lo) * (i + 0.5)) / n;
      const v = val(i);
      const x0 = pad.l + (pw * i) / n, x1 = pad.l + (pw * (i + 1)) / n;
      const top = pad.t + ph * (1 - v);
      const col = wavelengthRGB(nm);
      const grd = g.createLinearGradient(0, top, 0, pad.t + ph);
      grd.addColorStop(0, rgbCss(col, 0.95, 0.2));
      grd.addColorStop(1, rgbCss(col, 0.15, 0.2));
      g.fillStyle = grd;
      g.fillRect(x0, top, Math.max(1, x1 - x0 + 0.5), pad.t + ph - top);
    }
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = xOf(i), y = pad.t + ph * (1 - val(i));
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineWidth = 1.2;
    g.stroke();
    g.fillStyle = 'rgba(200,210,230,0.55)';
    g.font = AXIS_FONT;
    g.textBaseline = 'bottom';
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const nm = lo + ((hi - lo) * i) / ticks;
      const x = pad.l + (pw * i) / ticks;
      g.textAlign = i === 0 ? 'left' : i === ticks ? 'right' : 'center';
      g.fillText(`${nm.toFixed(0)}`, x, h - 2);
    }
  }, [spectrum, range[0], range[1]]);
  return <canvas ref={ref} className="chart" aria-label="Spectrum" />;
}

/** Hit-weighted mean colour (fallback when a reading has no profileRGB). */
function hitColour(hits?: DetectorReading['hits']): [number, number, number] {
  let r = 0.6, gg = 0.9, b = 1;
  if (hits && hits.length) {
    let sr = 0, sg = 0, sb = 0, sw = 0;
    for (const hh of hits.slice(0, 500)) {
      const c = wavelengthRGB(hh.wavelength);
      sr += c[0] * hh.power; sg += c[1] * hh.power; sb += c[2] * hh.power; sw += hh.power;
    }
    if (sw > 0) { const m = Math.max(sr, sg, sb) || 1; r = sr / m; gg = sg / m; b = sb / m; }
  }
  return [r, gg, b];
}

/**
 * Intensity profile: line graph + filled area on top, a true-colour intensity strip (profileRGB)
 * below. High-resolution (wave-mode) profiles are drawn as a crisp line without per-bin fill.
 */
function ProfileChart({ profile, rgb, hits }: { profile: number[]; rgb?: number[]; hits?: DetectorReading['hits'] }): React.JSX.Element {
  const ref = useCanvas((g, w, h) => {
    const n = profile.length;
    if (!n) return;
    const pad = 6;
    const max = maxOf(profile);
    const strip = profileStrip(profile, rgb);
    const stripH = 12;
    const pw = w - 2 * pad;
    // strip: one column per bin (or averaged per pixel when bins outnumber pixels)
    const cols = Math.max(1, Math.min(n, Math.round(pw)));
    for (let x = 0; x < cols; x++) {
      const i0 = Math.floor((x * n) / cols), i1 = Math.max(i0 + 1, Math.floor(((x + 1) * n) / cols));
      let r = 0, gg = 0, b = 0;
      for (let i = i0; i < i1; i++) { r += strip[i][0]; gg += strip[i][1]; b += strip[i][2]; }
      const k = i1 - i0;
      g.fillStyle = `rgb(${Math.round(r / k)},${Math.round(gg / k)},${Math.round(b / k)})`;
      g.fillRect(pad + (pw * x) / cols, h - stripH - 2, pw / cols + 0.5, stripH);
    }
    if (!(max > 0)) {
      g.fillStyle = 'rgba(200,210,230,0.55)';
      g.font = AXIS_FONT;
      g.textAlign = 'center';
      g.fillText('no light', w / 2, (h - stripH) / 2);
      return;
    }
    const ph = h - stripH - pad - 6;
    const [cr, cg, cb] = rgb && rgb.length >= 3 * n ? meanRGB(rgb) : hitColour(hits);
    const col = `rgba(${Math.round(cr * 255)}, ${Math.round(cg * 255)}, ${Math.round(cb * 255)}`;
    const val = (i: number): number => (finite(profile[i]) ? Math.max(0, profile[i]) / max : 0);
    g.beginPath();
    g.moveTo(pad, pad + ph);
    for (let i = 0; i < n; i++) g.lineTo(pad + (pw * (i + 0.5)) / n, pad + ph * (1 - val(i)));
    g.lineTo(w - pad, pad + ph);
    g.closePath();
    const grd = g.createLinearGradient(0, pad, 0, pad + ph);
    grd.addColorStop(0, `${col}, 0.5)`);
    grd.addColorStop(1, `${col}, 0.05)`);
    g.fillStyle = grd;
    g.fill();
    g.strokeStyle = `${col}, 0.95)`;
    g.lineWidth = n > 300 ? 1 : 1.2;
    g.stroke();
  }, [profile, rgb, hits]);
  return <canvas ref={ref} className="chart" aria-label="Intensity profile" />;
}

function meanRGB(rgb: number[]): [number, number, number] {
  let r = 0, g = 0, b = 0;
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    if (finite(rgb[i])) r += rgb[i];
    if (finite(rgb[i + 1])) g += rgb[i + 1];
    if (finite(rgb[i + 2])) b += rgb[i + 2];
  }
  const m = Math.max(r, g, b);
  return m > 0 ? [r / m, g / m, b / m] : [0.6, 0.9, 1];
}

/** 2D detector image (3D mode) as a heatmap, keeping the w × h aspect. */
function Heatmap({ image }: { image: DetImage }): React.JSX.Element {
  const pixels = useMemo(() => imagePixels(image), [image]);
  const ref = useCanvas((g, w, h) => {
    const iw = Math.floor(image.w), ih = Math.floor(image.h);
    if (!(iw > 0 && ih > 0)) return;
    const off = document.createElement('canvas');
    off.width = iw; off.height = ih;
    const og = off.getContext('2d');
    if (!og) return;
    og.putImageData(new ImageData(new Uint8ClampedArray(pixels), iw, ih), 0, 0);
    const aspect = (image.widthMm && image.heightMm ? image.widthMm / image.heightMm : iw / ih) || 1;
    let dw = w - 4, dh = dw / aspect;
    if (dh > h - 4) { dh = h - 4; dw = dh * aspect; }
    g.imageSmoothingEnabled = iw < dw / 2 ? false : true;
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.drawImage(off, (w - dw) / 2, (h - dh) / 2, dw, dh);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.strokeRect((w - dw) / 2 - 0.5, (h - dh) / 2 - 0.5, dw + 1, dh + 1);
  }, [pixels, image.w, image.h]);
  return <canvas ref={ref} className="chart heatmap" aria-label="Detector image" />;
}

/** Polarization ellipse + Poincaré disc. */
function PolarizationView({ stokes }: { stokes: NonNullable<DetectorReading['stokes']> }): React.JSX.Element {
  const ref = useCanvas((g, w, h) => {
    const size = Math.min(h - 8, (w - 18) / 2);
    if (!(size > 10)) return;
    const r = size / 2;
    const cx1 = 4 + r, cy = h / 2;
    const cx2 = w - 14 - r;
    // ellipse frame
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx1 - r, cy); g.lineTo(cx1 + r, cy); g.moveTo(cx1, cy - r); g.lineTo(cx1, cy + r); g.stroke();
    g.strokeRect(cx1 - r + 0.5, cy - r + 0.5, size - 1, size - 1);
    const dark = !(stokes.s0 > 0);
    if (!dark) {
      const pts = ellipsePoints(stokes.azimuth, stokes.ellipticity, 72);
      const k = r * 0.86;
      g.beginPath();
      pts.forEach((p, i) => { const x = cx1 + p.x * k, y = cy - p.y * k; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
      g.closePath();
      g.strokeStyle = `rgba(124,255,124,${0.35 + 0.65 * Math.max(0, Math.min(1, stokes.dop))})`;
      g.lineWidth = 1.6;
      g.stroke();
      const hand = handedness(stokes.ellipticity);
      if (hand !== 'linear') {
        // arrow head on the ellipse showing the rotation sense
        const i = 18, a = pts[i], b = pts[i + (hand === 'right' ? 1 : -1)];
        const ax = cx1 + a.x * k, ay = cy - a.y * k, bx = cx1 + b.x * k, by = cy - b.y * k;
        const ang = Math.atan2(by - ay, bx - ax);
        g.fillStyle = '#7cff7c';
        g.beginPath();
        g.moveTo(bx + Math.cos(ang) * 5, by + Math.sin(ang) * 5);
        g.lineTo(bx + Math.cos(ang + 2.5) * 5, by + Math.sin(ang + 2.5) * 5);
        g.lineTo(bx + Math.cos(ang - 2.5) * 5, by + Math.sin(ang - 2.5) * 5);
        g.closePath();
        g.fill();
      }
    }
    // Poincaré disc (s1 right, s2 up), s3 as a side bar
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 1;
    g.beginPath(); g.arc(cx2, cy, r, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.beginPath(); g.moveTo(cx2 - r, cy); g.lineTo(cx2 + r, cy); g.moveTo(cx2, cy - r); g.lineTo(cx2, cy + r); g.stroke();
    g.fillStyle = 'rgba(200,210,230,0.55)';
    g.font = AXIS_FONT;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('S1', cx2 + r - 14, cy - 7);
    g.textAlign = 'center';
    g.fillText('S2', cx2 + 9, cy - r + 6);
    const bx = cx2 + r + 6;
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.strokeRect(bx + 0.5, cy - r + 0.5, 5, size - 1);
    if (!dark) {
      const p = poincareXY(stokes.s1, stokes.s2);
      const s3 = Math.max(-1, Math.min(1, finite(stokes.s3) ? stokes.s3 : 0));
      g.fillStyle = s3 >= 0 ? '#ffd24a' : '#4ad2ff'; // upper / lower hemisphere
      g.beginPath(); g.arc(cx2 + p.x * r, cy - p.y * r, 3.5, 0, Math.PI * 2); g.fill();
      const y0 = cy, y1 = cy - s3 * (r - 1);
      g.fillRect(bx + 1, Math.min(y0, y1), 4, Math.max(1, Math.abs(y1 - y0)));
    }
  }, [stokes.s0, stokes.s1, stokes.s2, stokes.s3, stokes.dop, stokes.azimuth, stokes.ellipticity]);
  return <canvas ref={ref} className="chart polar" aria-label="Polarization ellipse and Poincaré sphere" />;
}

function num(v: number | undefined, digits = 3): string {
  if (!finite(v)) return '—';
  return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(digits);
}

function StokesTable({ stokes }: { stokes: NonNullable<DetectorReading['stokes']> }): React.JSX.Element {
  const hand = handedness(stokes.ellipticity);
  const rows: [string, string][] = [
    ['S0', formatSI(stokes.s0, 'W', 4)],
    ['s1', num(stokes.s1)], ['s2', num(stokes.s2)], ['s3', num(stokes.s3)],
    ['DOP', finite(stokes.dop) ? `${(stokes.dop * 100).toFixed(1)} %` : '—'],
    ['ψ', finite(stokes.azimuth) ? `${(stokes.azimuth * RAD2DEG).toFixed(2)}°` : '—'],
    ['χ', finite(stokes.ellipticity) ? `${(stokes.ellipticity * RAD2DEG).toFixed(2)}°` : '—'],
    ['', hand === 'linear' ? 'linear' : `${hand}-handed`]
  ];
  return (
    <div className="stokes-table mono">
      {rows.map(([k, v], i) => (
        <div key={i} className="stokes-row"><span className="k">{k}</span><span className="v">{v}</span></div>
      ))}
    </div>
  );
}

type Kind = 'spectrum' | 'camera' | 'screen' | 'polarimeter' | 'wavemeter' | 'concentrator' | 'power';

function kindOf(c: OpticalComponent, r?: Reading): Kind {
  if (c.type === 'detector.polarimeter' || r?.stokes) return 'polarimeter';
  if (c.type === 'detector.wavemeter' || finite(r?.meanWavelength)) return 'wavemeter';
  if (c.type === 'solar.concentrator' || finite(r?.concentration)) return 'concentrator';
  if (r?.spectrum?.length) return 'spectrum';
  if (c.type === 'detector.camera') return 'camera';
  if (r?.profile?.length || r?.image) return 'screen';
  return 'power';
}

function DetectorCard({ c, reading, dim }: { c: OpticalComponent; reading?: Reading; dim: '2d' | '3d' }): React.JSX.Element {
  const def = opticsDef(c.type);
  const sel = useApp((s) => s.selection.optics.includes(c.id));
  const power = reading?.power ?? 0;
  const kind = kindOf(c, reading);
  const peak = useMemo(() => {
    if (!reading?.spectrum?.length || !reading.spectrumRange) return null;
    let bi = 0;
    reading.spectrum.forEach((v, i) => { if (v > reading.spectrum![bi]) bi = i; });
    if (!(reading.spectrum[bi] > 0)) return null;
    const [lo, hi] = reading.spectrumRange;
    return lo + ((hi - lo) * (bi + 0.5)) / reading.spectrum.length;
  }, [reading?.spectrum, reading?.spectrumRange]);
  const vis = useMemo(() => (reading?.profile && reading.profile.length >= 256 ? fringeVisibility(reading.profile) : null), [reading?.profile]);
  const image = dim === '3d' && reading?.image && maxOf(reading.image.data ?? []) > 0 ? reading.image : undefined;
  const hasProfile = !!reading?.profile?.length;
  const wide = kind === 'spectrum' || kind === 'polarimeter' || ((kind === 'camera' || kind === 'screen') && (hasProfile || !!image));

  let main = reading ? formatSI(power, 'W', 4) : '—';
  let sub = reading ? dBm(power) : 'no reading';
  if (reading && kind === 'spectrum' && peak !== null) sub += ` · peak ${peak.toFixed(1)} nm`;
  if (reading && (kind === 'camera' || kind === 'screen') && vis !== null) sub += ` · V = ${vis.toFixed(3)}`;
  if (kind === 'wavemeter') {
    const wl = reading?.meanWavelength;
    main = finite(wl) && power > 0 ? `${wl.toFixed(3)} nm` : '— nm';
    sub = finite(wl) && power > 0
      ? `${wavelengthToTHz(wl).toFixed(4)} THz · Δλ ${formatLinewidth(reading?.linewidth ?? 0)} (${formatSI(linewidthHz(wl, reading?.linewidth ?? 0), 'Hz', 3)}) · ${formatSI(power, 'W', 3)}`
      : reading ? 'no light' : 'no reading';
  } else if (kind === 'concentrator') {
    const cr = reading?.concentration;
    main = finite(cr) ? `× ${cr.toFixed(1)}` : '× —';
    sub = reading ? `concentration · absorbed ${formatSI(power, 'W', 4)}` : 'no reading';
  }

  return (
    <div className={`inst-card kind-${kind}${sel ? ' selected' : ''}${wide ? ' wide' : ''}`} data-kind={kind} onClick={() => useApp.getState().setSelection('optics', [c.id])}>
      <div className="inst-head">
        <span className="inst-glyph"><TypeGlyph type={c.type} /></span>
        <span className="inst-name">{c.name || def?.label || c.type}</span>
        {(c.name && c.name !== (def?.label ?? c.type)) && <span className="inst-type dim">{def?.label ?? c.type}</span>}
      </div>
      <div className="inst-body">
        <div className="readout">
          <div className={`readout-main mono${kind === 'wavemeter' || kind === 'concentrator' ? ' big' : ''}`}>{main}</div>
          <div className="readout-sub mono dim">{sub}</div>
        </div>
        {kind === 'spectrum' && reading?.spectrum && (
          <SpectrumChart spectrum={reading.spectrum} range={reading.spectrumRange ?? [380, 780]} />
        )}
        {(kind === 'camera' || kind === 'screen') && image && <Heatmap image={image} />}
        {(kind === 'camera' || kind === 'screen') && hasProfile && (
          <ProfileChart profile={reading!.profile!} rgb={reading!.profileRGB} hits={reading!.hits} />
        )}
        {kind === 'polarimeter' && reading?.stokes && (
          <div className="polar-row">
            <StokesTable stokes={reading.stokes} />
            <PolarizationView stokes={reading.stokes} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Optical components shown in the Instruments dock: detectors, plus anything that produced a reading. */
export function isInstrument(c: OpticalComponent, readings?: Record<string, unknown>): boolean {
  if (c.type.startsWith('detector.') || c.type === 'solar.concentrator') return true;
  if (readings && readings[c.id]) return true;
  return opticsDef(c.type)?.category === 'Detectors';
}

export function Instruments(): React.JSX.Element {
  const components = useApp((s) => s.doc?.optics.components ?? NO_COMPONENTS);
  const dim = useApp((s) => (s as unknown as { opticsDim?: '2d' | '3d' }).opticsDim ?? s.doc?.meta.dimension ?? '2d');
  const r2 = useSim((s) => s.trace?.detectors);
  const r3 = useSim((s) => s.trace3d?.detectors);
  const readings: Record<string, Reading> | undefined = dim === '3d' && r3 ? r3 : r2;
  const detectors = useMemo(() => components.filter((c) => isInstrument(c, readings)), [components, readings]);
  if (!detectors.length) {
    return <div className="dock-empty">No optical detectors in the scene. Add a power meter, screen, camera, polarimeter or wavemeter from the <b>Detectors</b> palette group.</div>;
  }
  return (
    <div className="instruments">
      {detectors.map((c) => <DetectorCard key={c.id} c={c} reading={readings?.[c.id]} dim={dim} />)}
    </div>
  );
}

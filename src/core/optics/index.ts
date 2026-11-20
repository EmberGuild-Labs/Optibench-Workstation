/**
 * Optibench optics engine - public entry point.
 * Pure TypeScript (no DOM / Node APIs); safe to run in a Web Worker.
 */
import type { OpticalComponent, OpticsEngineAPI } from '../types';
import { wavelengthToRGB } from './color';
import { geometryOf } from './compile';
import { MATERIALS } from './materials';
import { REGISTRY, createComponent, defaultSettings } from './registry';
import { trace } from './tracer';

const GEOMETRY_SETTINGS = defaultSettings();

export const opticsEngine: OpticsEngineAPI = {
  registry: REGISTRY,
  defaultSettings,
  createComponent,
  getGeometry: (c: OpticalComponent) => geometryOf(c, GEOMETRY_SETTINGS),
  trace,
  materials: MATERIALS,
  wavelengthToRGB,
};

export default opticsEngine;

export { trace, fresnelComplex, silicaAttenuationDbPerKm } from './tracer';
export type { DetailedTraceResult, TraceEnergy } from './tracer';
export { wavelengthToRGB, spectrumToRGB, cieXYZ, xyzToLinearSRGB, linearToSRGB, planck } from './color';
export { MATERIALS, METALS, getMaterial, customMaterial, refractiveIndex, nAir } from './materials';
export type { Material, Metal } from './materials';
export { REGISTRY, createComponent, defaultSettings, getTypeDef, getDefaults } from './registry';
export { geometryOf as getGeometry } from './compile';
export { lensOutline, lensmakerFocal } from './components/elements';
export { bandSpectrum, gaussSpectrum, whiteLedSpd, sourceTemporalEnvelope, gaussianBeamProfile, laserCavityOutput } from './components/sources';
export { componentTimeTransmission, aomBraggAngle } from './components/extra';
export { coherenceLengthMm, degreeOfCoherence } from './wave';
export type { CohGroup } from './wave';

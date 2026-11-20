/**
 * Optibench 3D optics engine — public entry point. Pure TypeScript (no DOM / Node APIs).
 * Contract: src/core/types3d.ts. Conventions: ./math.ts. Mesh roles / materials: ./geometry3d.ts.
 */
import type { Optics3DEngineAPI } from '../types3d';
import { getGeometry3D } from './geometry3d';
import { localToWorld, poseOf, worldToLocal } from './math';
import { trace3D } from './tracer3d';

export const optics3dEngine: Optics3DEngineAPI = { getGeometry3D, trace3D, poseOf, localToWorld, worldToLocal };

export default optics3dEngine;

export { to3D, from3D, yawOf, poseOf, frameOf, localToWorld, worldToLocal, convert2Dto3D, flatten3Dto2D } from './math';
export type { Frame } from './math';
export { trace3D } from './tracer3d';
export type { DetailedTrace3DResult, DetectorReading3DEx, Trace3DEnergy } from './tracer3d';
export { getGeometry3D, clearGeometryCache } from './geometry3d';
export { buildModel } from './model';

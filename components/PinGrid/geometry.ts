// components/PinGrid/geometry.ts
import { SPACING, MAX_DIST, MAX_DIST_SQ } from './constants';

/**
 * Builds a hex-packed grid covering the given screen dims.
 * Odd rows are offset by SPACING/2 horizontally; rows are SPACING * sin(60deg) apart.
 */
export function buildHexGrid(screenW: number, screenH: number) {
  const rowStep = SPACING * Math.sin(Math.PI / 3); // ~12.12px for SPACING=14
  const cols = Math.ceil(screenW / SPACING) + 2;
  const rows = Math.ceil(screenH / rowStep) + 2;
  const pinCount = rows * cols;
  const X = new Float32Array(pinCount);
  const Y = new Float32Array(pinCount);
  const offsetX = (screenW - (cols - 1) * SPACING) / 2;
  const offsetY = (screenH - (rows - 1) * rowStep) / 2;
  for (let r = 0; r < rows; r++) {
    const rowOffset = (r % 2 === 0) ? 0 : SPACING / 2;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      X[i] = c * SPACING + rowOffset + offsetX;
      Y[i] = r * rowStep + offsetY;
    }
  }
  return { X, Y, pinCount, rows, cols };
}

/**
 * Smoothstep falloff: 1 at distance=0, 0 at distance>=MAX_DIST, with a Hermite curve in between.
 * Sharper boundary than pow(r, k) — full pressure under the contact patch, zero outside.
 */
export function pressureAt(distSq: number): number {
  'worklet';
  if (distSq >= MAX_DIST * MAX_DIST) return 0;
  const dist = Math.sqrt(distSq);
  const t = 1 - dist / MAX_DIST;     // 1 at center → 0 at edge
  return t * t * (3 - 2 * t);        // smoothstep(t)
}

/**
 * Computes an imprint Float32Array from a list of touches against a hex grid.
 * Same math as the per-frame UI-thread merge, intended for one-shot use on JS thread.
 */
export function imprintFromTouches(
  X: Float32Array,
  Y: Float32Array,
  pinCount: number,
  touches: { x: number; y: number; r: number }[]
): Float32Array {
  const out = new Float32Array(pinCount);
  for (let i = 0; i < pinCount; i++) {
    const bx = X[i];
    const by = Y[i];
    let live = 0;
    for (let j = 0; j < touches.length; j++) {
      const t = touches[j];
      const dx = bx - t.x;
      const dy = by - t.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < MAX_DIST_SQ) {
        const dist = Math.sqrt(d2);
        const u = 1 - dist / MAX_DIST;
        const p = u * u * (3 - 2 * u);
        if (p > live) live = p;
      }
    }
    out[i] = live;
  }
  return out;
}

// components/PinGrid/geometry.ts
import { SPACING, MAX_DIST } from './constants';

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

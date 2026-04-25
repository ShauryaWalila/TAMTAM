// lib/touchRecording.ts
import { Touch, TouchFrame, TouchRecording } from '@/components/PinGrid/types';

// ---------- Recorder ----------

export type Recorder = {
  tick: (touches: Touch[], nowMs: number) => void;
  finalize: (
    finalImprint: Float32Array,
    screen: { w: number; h: number }
  ) => TouchRecording;
  reset: () => void;
};

const FRAME_INTERVAL_MS = 33;       // ~30fps
const MAX_DURATION_MS = 10_000;     // cap to bound payload size

export function createRecorder(): Recorder {
  let frames: TouchFrame[] = [];
  let startMs: number | null = null;
  let lastFrameMs = 0;

  const samePoints = (a: Touch[], b: Touch[]) => {
    if (a.length !== b.length) return false;
    const idsA = new Set(a.map((t) => t.id));
    for (const t of b) if (!idsA.has(t.id)) return false;
    for (const t of b) {
      const m = a.find((x) => x.id === t.id);
      if (!m) return false;
      if (Math.abs(m.x - t.x) >= 1) return false;
      if (Math.abs(m.y - t.y) >= 1) return false;
      if (Math.abs(m.r - t.r) >= 1) return false;
    }
    return true;
  };

  return {
    tick(touches, nowMs) {
      if (touches.length === 0 && startMs === null) return; // no recording yet
      if (startMs === null) startMs = nowMs;
      const t = nowMs - startMs;
      if (t > MAX_DURATION_MS) return;
      if (nowMs - lastFrameMs < FRAME_INTERVAL_MS) return;
      const prev = frames[frames.length - 1];
      if (prev && samePoints(prev.points, touches)) {
        lastFrameMs = nowMs;
        return;
      }
      frames.push({ t, points: touches.map((p) => ({ ...p })) });
      lastFrameMs = nowMs;
    },
    finalize(finalImprint, screen) {
      const duration_ms = startMs === null ? 0 : (frames[frames.length - 1]?.t ?? 0);
      return {
        v: 1,
        duration_ms,
        screen,
        frames,
        final_imprint: float32ToBase64(finalImprint),
      };
    },
    reset() {
      frames = [];
      startMs = null;
      lastFrameMs = 0;
    },
  };
}

// ---------- Player ----------

export type Player = {
  frameAt: (elapsedMs: number) => Touch[];
  totalDurationMs: number;
};

export function createPlayer(rec: TouchRecording): Player {
  const frames = rec.frames;
  return {
    totalDurationMs: rec.duration_ms,
    frameAt(elapsedMs) {
      if (frames.length === 0 || elapsedMs <= 0) return [];
      if (elapsedMs >= rec.duration_ms) return [];
      // binary search for the frame with t <= elapsed
      let lo = 0, hi = frames.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (frames[mid].t <= elapsedMs) lo = mid;
        else hi = mid - 1;
      }
      const a = frames[lo];
      const b = frames[lo + 1];
      if (!b) return a.points;
      // interpolate per-id between a and b
      const span = b.t - a.t;
      const u = span > 0 ? (elapsedMs - a.t) / span : 0;
      const out: Touch[] = [];
      for (const pa of a.points) {
        const pb = b.points.find((p) => p.id === pa.id);
        if (pb) {
          out.push({
            id: pa.id,
            x: pa.x + (pb.x - pa.x) * u,
            y: pa.y + (pb.y - pa.y) * u,
            r: pa.r + (pb.r - pa.r) * u,
          });
        } else {
          out.push(pa);
        }
      }
      return out;
    },
  };
}

// ---------- Float32Array <-> base64 ----------

export function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // global.btoa available in Hermes/RN
  return global.btoa(bin);
}

export function base64ToFloat32(b64: string): Float32Array {
  const bin = global.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // Ensure aligned: copy bytes into a fresh ArrayBuffer
  const aligned = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(aligned).set(bytes);
  return new Float32Array(aligned);
}

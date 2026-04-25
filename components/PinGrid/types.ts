// components/PinGrid/types.ts
export type Touch = {
  id: number;
  x: number;
  y: number;
  r: number; // contact radius in px; 14 default when device doesn't expose it
};

export type TouchFrame = {
  t: number;          // ms since recording start
  points: Touch[];
};

export type TouchRecording = {
  v: 1;
  duration_ms: number;
  screen: { w: number; h: number };
  frames: TouchFrame[];
  final_imprint: string;   // base64-encoded Float32Array of held pressed amounts (length = pin count for sender's screen)
};

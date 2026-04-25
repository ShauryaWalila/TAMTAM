// components/PinGrid/constants.ts
export const SPACING = 14;            // px between pins (hex grid step)
export const MAX_DIST = 22;           // px — beyond this no pin movement
export const MAX_DIST_SQ = MAX_DIST * MAX_DIST;
export const PIN_CAP_RADIUS = 5;      // resting cap radius
export const MAX_DEPRESSION_PX = 8;   // how far a fully-pressed pin sinks (kept under SPACING/2 to avoid row overlap)
export const PARALLAX_FACTOR = 0.04;  // perspective shift toward edges
export const PRESS_THRESHOLD = 0.05;  // below this, pin is considered untouched
export const DEFAULT_TOUCH_RADIUS = 14;

// Colors (pin-art look — no glow)
export const COLOR_BG_TOP = '#101012';
export const COLOR_BG_BOTTOM = '#050506';
export const COLOR_STEM = '#1a1a1a';
export const COLOR_CAP_RESTING = '#9aa0a6';
export const COLOR_CAP_PRESSED = '#3a3a3a';
export const COLOR_PIN_SHADOW = '#000000';

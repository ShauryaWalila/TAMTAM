// Tiny in-app error buffer. Survives one app lifetime + persists most recent
// 50 entries to AsyncStorage so a crash followed by relaunch still leaves
// a breadcrumb. Use this when Console.app / Xcode aren't available.
//
// Usage:
//   import { dbg } from '@/lib/debugLog';
//   dbg.error('thing failed', err);
//   const log = dbg.recent();  // latest entries first
//
// A viewer is rendered from app/(tabs)/index.tsx via a hidden long-press tap.

import AsyncStorage from '@react-native-async-storage/async-storage';

interface Entry {
  at: string;     // ISO timestamp
  level: 'info' | 'warn' | 'error';
  msg: string;
}

const KEY = 'tamtam_debug_log';
const MAX = 50;

let buffer: Entry[] = [];
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) buffer = JSON.parse(raw);
  } catch {}
  loaded = true;
}

function flush() {
  // Fire-and-forget; persistence is best-effort.
  AsyncStorage.setItem(KEY, JSON.stringify(buffer.slice(-MAX))).catch(() => {});
}

function push(level: Entry['level'], msg: string) {
  buffer.push({ at: new Date().toISOString(), level, msg });
  if (buffer.length > MAX) buffer = buffer.slice(-MAX);
  flush();
}

function fmt(args: any[]): string {
  return args.map(a => {
    if (a == null) return String(a);
    if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? '\n' + a.stack : ''}`;
    if (typeof a === 'object') {
      try { return JSON.stringify(a, Object.getOwnPropertyNames(a)); } catch { return String(a); }
    }
    return String(a);
  }).join(' ');
}

export const dbg = {
  info: (...args: any[]) => push('info', fmt(args)),
  warn: (...args: any[]) => push('warn', fmt(args)),
  error: (...args: any[]) => push('error', fmt(args)),
  recent: async (): Promise<Entry[]> => {
    await ensureLoaded();
    return [...buffer].reverse();
  },
  clear: async () => {
    buffer = [];
    try { await AsyncStorage.removeItem(KEY); } catch {}
  },
};

// Install once: replace console.warn / console.error so existing warns also
// land in the buffer. Also install a JS-thread global error handler so any
// unhandled promise rejection / thrown error from a TurboModule conversion
// shows up next launch.
let installed = false;
export function installDebugCapture() {
  if (installed) return;
  installed = true;
  try {
    const origWarn = console.warn;
    console.warn = (...args: any[]) => { try { push('warn', fmt(args)); } catch {} origWarn(...args); };
    const origError = console.error;
    console.error = (...args: any[]) => { try { push('error', fmt(args)); } catch {} origError(...args); };
  } catch {}
  try {
    const g: any = (global as any);
    if (g.ErrorUtils && typeof g.ErrorUtils.getGlobalHandler === 'function') {
      const prev = g.ErrorUtils.getGlobalHandler();
      g.ErrorUtils.setGlobalHandler((e: any, isFatal: boolean) => {
        try { push('error', `[fatal=${!!isFatal}] ${fmt([e])}`); } catch {}
        try { prev && prev(e, isFatal); } catch {}
      });
    }
  } catch {}
  // load existing buffer in background
  ensureLoaded();
}

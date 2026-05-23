// JS wrapper around the native PencilCanvasView (see /pencil-canvas/).
// Provides an imperative ref API: clear, undo, redo, getBase64, loadBase64,
// getPng. The native side handles all PencilKit input at 120 Hz so React
// state never touches stroke samples.

import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { findNodeHandle, NativeModules, requireNativeComponent, type ViewProps } from 'react-native';

type NativeProps = ViewProps & {
  onDrawingChange?: (e: any) => void;
};

const NativePencilCanvas = requireNativeComponent<NativeProps>('PencilCanvasView');
const { PencilCanvasViewManager } = NativeModules as {
  PencilCanvasViewManager?: {
    clear: (tag: number) => void;
    undo: (tag: number) => void;
    redo: (tag: number) => void;
    getBase64: (tag: number) => Promise<string>;
    loadBase64: (tag: number, data: string) => Promise<boolean>;
    getPng: (tag: number, scale: number) => Promise<string>;
  };
};

export type PencilCanvasRef = {
  clear: () => void;
  undo: () => void;
  redo: () => void;
  getBase64: () => Promise<string>;
  loadBase64: (data: string) => Promise<boolean>;
  getPng: (scale?: number) => Promise<string>;
};

type Props = {
  onDrawingChange?: () => void;
  style?: ViewProps['style'];
  pointerEvents?: ViewProps['pointerEvents'];
};

const PencilCanvas = forwardRef<PencilCanvasRef, Props>(({ onDrawingChange, style, pointerEvents }, ref) => {
  const nativeRef = useRef<any>(null);
  const tag = () => findNodeHandle(nativeRef.current);

  useImperativeHandle(ref, () => ({
    clear: () => { const t = tag(); if (t != null) PencilCanvasViewManager?.clear(t); },
    undo:  () => { const t = tag(); if (t != null) PencilCanvasViewManager?.undo(t); },
    redo:  () => { const t = tag(); if (t != null) PencilCanvasViewManager?.redo(t); },
    getBase64: async () => {
      const t = tag(); if (t == null || !PencilCanvasViewManager) return '';
      try { return await PencilCanvasViewManager.getBase64(t); } catch { return ''; }
    },
    loadBase64: async (data: string) => {
      const t = tag(); if (t == null || !PencilCanvasViewManager) return false;
      try { return await PencilCanvasViewManager.loadBase64(t, data); } catch { return false; }
    },
    getPng: async (scale = 2) => {
      const t = tag(); if (t == null || !PencilCanvasViewManager) return '';
      try { return await PencilCanvasViewManager.getPng(t, scale); } catch { return ''; }
    },
  }), []);

  return (
    <NativePencilCanvas
      ref={nativeRef}
      style={style}
      pointerEvents={pointerEvents}
      onDrawingChange={onDrawingChange ? () => onDrawingChange() : undefined}
    />
  );
});

export default PencilCanvas;

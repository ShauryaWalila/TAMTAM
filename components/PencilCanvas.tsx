// JS wrapper around the native PencilCanvasView (see /pencil-canvas/).
// Provides an imperative ref API: clear, undo, redo, getBase64, loadBase64,
// getPng. The native side handles all PencilKit input at 120 Hz so React
// state never touches stroke samples.

import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { findNodeHandle, NativeModules, requireNativeComponent, StyleSheet, UIManager, View, type ViewProps } from 'react-native';

type NativeProps = ViewProps & {
  onDrawingChange?: (e: any) => void;
};

// Guard: only requireNativeComponent when the manager is actually registered.
// During development (Expo Go) or before the IPA has been rebuilt with the new
// native module, the manager won't exist — we fall back to a transparent View
// so the rest of the screen keeps working and the user can still draw via
// the underlying Skia layer.
const HAS_NATIVE = !!(UIManager as any)?.getViewManagerConfig?.('PencilCanvasView');
const NativePencilCanvas: any = HAS_NATIVE
  ? requireNativeComponent<NativeProps>('PencilCanvasView')
  : View;
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

  // If the native module isn't compiled into the IPA yet, render an inert
  // pass-through view so touches reach the underlying Skia canvas. The user
  // can still draw with the legacy engine until the next rebuild.
  if (!HAS_NATIVE) {
    return <View style={style} pointerEvents="none" />;
  }
  // Wrap the native view in a regular RN View so React Native's standard
  // `pointerEvents` handling (which disables userInteraction on the subtree)
  // applies. The native view doesn't natively read the prop.
  return (
    <View style={style} pointerEvents={pointerEvents}>
      <NativePencilCanvas
        ref={nativeRef}
        style={StyleSheet.absoluteFill}
        onDrawingChange={onDrawingChange ? () => onDrawingChange() : undefined}
      />
    </View>
  );
});

export default PencilCanvas;

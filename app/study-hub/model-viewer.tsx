import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, RotateCw } from 'lucide-react-native';
import { WebView } from 'react-native-webview';
import { ensureModelViewerCached } from '@/lib/anatomyLibrary';

// Renders a .glb via Google's <model-viewer> web component. Works offline
// when the GLB is cached locally and the JS bundle is cached too.
export default function ModelViewerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme() ?? 'light'];
  const params = useLocalSearchParams<{ url?: string; title?: string; from?: string; chatId?: string }>();
  const fromBuddy = params.from === 'buddy';
  const [mvSrc, setMvSrc] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);

  useEffect(() => {
    (async () => {
      const src = await ensureModelViewerCached();
      setMvSrc(src);
    })();
  }, []);

  const html = useMemo(() => {
    if (!params.url || !mvSrc) return '';
    const isLocalScript = mvSrc.startsWith('file://') || mvSrc.startsWith('/');
    const scriptSrc = isLocalScript ? mvSrc.replace(/^file:\/\//, '') : mvSrc;
    const modelSrc = String(params.url);
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
<style>
  html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden;}
  model-viewer{width:100%;height:100%;background:linear-gradient(180deg,#101820,#000);--poster-color:transparent;}
  .hint{position:absolute;bottom:14px;left:0;right:0;text-align:center;color:#fff7;font:600 11px/1 -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:0.6px;text-transform:uppercase;pointer-events:none;}
</style>
<script type="module" src="${scriptSrc}"></script>
</head><body>
  <model-viewer
    id="mv"
    src="${modelSrc}"
    camera-controls
    touch-action="pan-y"
    interaction-prompt="auto"
    ${autoRotate ? 'auto-rotate' : ''}
    auto-rotate-delay="0"
    exposure="1"
    shadow-intensity="0.6"
    environment-image="neutral">
  </model-viewer>
  <div class="hint">Drag to orbit · pinch to zoom · two-finger pan</div>
  <script>
    const mv = document.getElementById('mv');
    mv.addEventListener('load', () => {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type:'loaded' }));
    });
    mv.addEventListener('error', (e) => {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type:'error', err: String(e.detail || e) }));
    });
  </script>
</body></html>`;
  }, [params.url, mvSrc, autoRotate]);

  if (!params.url) {
    return (
      <ThemedView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>No model URL provided.</Text>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><ChevronLeft size={22} color="#fff" /></TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{params.title || '3D Model'}</Text>
        <TouchableOpacity onPress={() => setAutoRotate(a => !a)} style={[styles.iconBtn, { backgroundColor: autoRotate ? theme.tint : 'rgba(255,255,255,0.1)' }]}>
          <RotateCw size={18} color="#fff" />
        </TouchableOpacity>
      </View>
      {!html ? (
        <View style={styles.loader}><ActivityIndicator color="#fff" /></View>
      ) : (
        <WebView
          originWhitelist={['*']}
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          javaScriptEnabled
          domStorageEnabled
          source={{ html, baseUrl: 'file://' }}
          style={{ flex: 1, backgroundColor: '#000' }}
          mixedContentMode="always"
        />
      )}
      {fromBuddy && (
        <TouchableOpacity
          onPress={() => router.push({ pathname: '/study-hub/buddy', params: params.chatId ? { resume: String(params.chatId) } : {} })}
          style={[styles.backToBuddyChip, { bottom: insets.bottom + 20 }]}
        >
          <RotateCw size={14} color="#fff" />
          <Text style={styles.backToBuddyText}>Back to Buddy</Text>
        </TouchableOpacity>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 10, backgroundColor: '#000', gap: 10 },
  iconBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  title: { color: '#fff', fontSize: 15, fontWeight: '800', flex: 1 },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  backToBuddyChip: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 24, backgroundColor: '#AF52DE', elevation: 8, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10 },
  backToBuddyText: { color: '#fff', fontWeight: '900', fontSize: 13, letterSpacing: 0.5 },
});

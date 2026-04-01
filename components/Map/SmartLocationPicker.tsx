import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions, ActivityIndicator, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { X, MapPin, Sparkles, CheckCircle2, Navigation, ArrowRight } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import { MotiView, AnimatePresence } from 'moti';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const { width } = Dimensions.get('window');

interface SmartLocationPickerProps {
  onLocationCaptured: (data: { name: string, lat: number, lng: number }) => void;
  onClose: () => void;
  title?: string;
}

export default function SmartLocationPicker({ onLocationCaptured, onClose, title = "Capture Location" }: SmartLocationPickerProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  const [capturedData, setCapturedData] = useState<{ name: string, lat: number, lng: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const handleNavigationStateChange = (navState: any) => {
    const url = navState.url;
    
    // 1. Extract Coordinates
    const coordRegex = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
    const match = url.match(coordRegex);
    
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      
      // 2. Extract Place Name (if available in Google Maps URL)
      let name = "Selected Spot";
      const nameMatch = url.match(/\/place\/([^/]+)\//);
      if (nameMatch) {
        name = decodeURIComponent(nameMatch[1].replace(/\+/g, ' '));
      }

      const newData = { name, lat, lng };
      
      // Trigger haptic and update preview if it's a new place
      if (!capturedData || capturedData.lat !== lat || capturedData.lng !== lng) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setCapturedData(newData);
      }
    }
  };

  const handleConfirm = () => {
    if (capturedData) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onLocationCaptured(capturedData);
      onClose();
    }
  };

  return (
    <View style={styles.container}>
      {/* 🏙️ PREMIUM HEADER */}
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: theme.background }]}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <X size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* 🗺️ MAP WEBVIEW */}
      <View style={styles.webviewContainer}>
        <WebView 
          source={{ uri: 'https://www.google.com/maps' }} 
          onNavigationStateChange={handleNavigationStateChange}
          onLoadEnd={() => setIsLoading(false)}
          style={styles.webview}
        />
        {isLoading && (
          <View style={[styles.loader, { backgroundColor: theme.background }]}>
            <ActivityIndicator size="large" color={theme.tint} />
            <Text style={[styles.loaderText, { color: theme.tabIconDefault }]}>Opening Maps...</Text>
          </View>
        )}
      </View>

      {/* 🪄 SMART CAPTURE PREVIEW */}
      <AnimatePresence>
        {capturedData && (
          <MotiView 
            from={{ opacity: 0, translateY: 100 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={{ opacity: 0, translateY: 100 }}
            style={[styles.previewCard, { bottom: insets.bottom + 20 }]}
          >
            <BlurView intensity={100} tint={colorScheme} style={styles.previewBlur}>
              <View style={styles.previewContent}>
                <View style={[styles.iconBox, { backgroundColor: theme.tint + '20' }]}>
                  <MapPin size={24} color={theme.tint} fill={theme.tint} />
                </View>
                <View style={styles.infoBox}>
                  <Text style={[styles.placeName, { color: theme.text }]} numberOfLines={1}>{capturedData.name}</Text>
                  <Text style={[styles.coords, { color: theme.tabIconDefault }]}>
                    {capturedData.lat.toFixed(5)}, {capturedData.lng.toFixed(5)}
                  </Text>
                </View>
                <TouchableOpacity onPress={handleConfirm} style={[styles.confirmBtn, { backgroundColor: theme.tint }]}>
                  <Text style={styles.confirmText}>CONFIRM</Text>
                  <CheckCircle2 size={18} color="white" />
                </TouchableOpacity>
              </View>
            </BlurView>
          </MotiView>
        )}
      </AnimatePresence>

      {/* 💡 HINT BAR (Only shown when nothing is captured) */}
      {!capturedData && !isLoading && (
        <MotiView 
          from={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          style={[styles.hintBar, { bottom: insets.bottom + 20 }]}
        >
          <BlurView intensity={80} tint="dark" style={styles.hintBlur}>
            <Sparkles size={16} color="white" />
            <Text style={styles.hintText}>Search and tap a place to capture it!</Text>
          </BlurView>
        </MotiView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { height: 100, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  closeBtn: { padding: 8, borderRadius: 12, backgroundColor: 'rgba(150,150,150,0.1)' },
  title: { fontSize: 18, fontWeight: '900', letterSpacing: -0.5 },
  webviewContainer: { flex: 1 },
  webview: { flex: 1 },
  loader: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', gap: 15 },
  loaderText: { fontSize: 14, fontWeight: '700' },
  previewCard: { position: 'absolute', left: 15, right: 15, zIndex: 1000 },
  previewBlur: { borderRadius: 28, padding: 15, overflow: 'hidden', elevation: 20, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 15 },
  previewContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: { width: 50, height: 50, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  infoBox: { flex: 1 },
  placeName: { fontSize: 17, fontWeight: '800' },
  coords: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 16, elevation: 5 },
  confirmText: { color: 'white', fontWeight: '900', fontSize: 14 },
  hintBar: { position: 'absolute', alignSelf: 'center', zIndex: 100 },
  hintBlur: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 25, paddingVertical: 12, borderRadius: 30 },
  hintText: { color: 'white', fontWeight: '700', fontSize: 13 }
});

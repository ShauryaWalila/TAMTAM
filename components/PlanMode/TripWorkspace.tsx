import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions, Image, ScrollView, Modal, TextInput, Alert, ActivityIndicator } from 'react-native';
import { BlurView } from 'expo-blur';
import { X, Calendar, MapPin, ChevronRight, Menu, Search, Palette, Wallet, Briefcase, Plus, TrendingUp, RotateCcw, Download, Settings, Trash2, Camera, Globe, CheckCircle2 } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS, useDerivedValue } from 'react-native-reanimated';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import ActivityIcon from './ActivityIcon';
import Bucket from './Bucket';
import Wardrobe from './Wardrobe';
import DayDetails from './DayDetails';
import DayReorderList from './DayReorderList';
import TripFinance from './TripFinance';

const { width, height } = Dimensions.get('window');
const MIN_HEIGHT = 260;

interface TripWorkspaceProps {
  tripId: string;
  userId: string;
  onBack: () => void;
  mapRef: any;
  onMarkersChange: (markers: any[]) => void;
  onSnapChange: (snap: 'min' | 'mid' | 'max') => void;
  onDayChange: (dayIndex: number) => void;
  isReadOnly?: boolean;
}

export default function TripWorkspace({ tripId, userId, onBack, mapRef, onMarkersChange, onSnapChange, onDayChange, isReadOnly }: TripWorkspaceProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  const [activeView, setActiveView] = useState<'map' | 'canvas' | 'bucket' | 'wardrobe' | 'finance'>('map');
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [selectedDay, setSelectedDay] = useState<any | null>(null);
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [currentSnap, setCurrentSnap] = useState<'min' | 'mid' | 'max'>('min');
  
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => [MIN_HEIGHT, '50%', '95%'], []);

  const handleSheetChange = (index: number) => {
    const snaps: ('min' | 'mid' | 'max')[] = ['min', 'mid', 'max'];
    setCurrentSnap(snaps[index]);
    onSnapChange(snaps[index]);
  };

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* Dynamic Header - Shown when sheet is not max */}
      <AnimatePresence>
        {currentSnap !== 'max' && (
          <MotiView 
            from={{ opacity: 0, translateY: -20 }} 
            animate={{ opacity: 1, translateY: 0 }} 
            exit={{ opacity: 0, translateY: -20 }}
            style={[styles.floatingHeader, { paddingTop: insets.top + 10 }]}
          >
            <BlurView intensity={80} tint={colorScheme} style={StyleSheet.absoluteFill} />
            <TouchableOpacity onPress={onBack} style={styles.headerBack}>
              <X size={24} color={theme.text} />
            </TouchableOpacity>
            <View style={styles.headerInfo}>
              <Text style={[styles.headerSubtitle, { color: theme.tabIconDefault }]}>PLANNING</Text>
              <Text style={[styles.headerTitle, { color: theme.text }]}>Our Trip</Text>
            </View>
          </MotiView>
        )}
      </AnimatePresence>

      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        onChange={handleSheetChange}
        backgroundStyle={{ backgroundColor: theme.card }}
        handleIndicatorStyle={{ backgroundColor: theme.tabIconDefault + '40' }}
      >
        <BottomSheetScrollView contentContainerStyle={{ paddingBottom: 100 }}>
          <DayReorderList 
            tripId={tripId} 
            activeDayIndex={activeDayIndex}
            onSelectDay={(day) => setSelectedDay(day)}
            onDayChange={(idx) => {
              setActiveDayIndex(idx);
              onDayChange(idx);
            }}
          />
        </BottomSheetScrollView>
      </BottomSheet>

      {/* Workspace FABs */}
      <View style={[styles.workspaceFabContainer, { bottom: MIN_HEIGHT + insets.bottom + 20 }]} pointerEvents="box-none">
        <AnimatePresence>
          {isWorkspaceMenuOpen && (
            <MotiView style={styles.workspaceFabSubMenu}>
              <TouchableOpacity style={[styles.workspaceSubBtn, { backgroundColor: '#555' }]} onPress={() => setIsSettingsVisible(true)}>
                <Settings size={20} color="white" />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.workspaceSubBtn, { backgroundColor: theme.tint }]} onPress={() => setActiveView('finance')}>
                <Wallet size={20} color="white" />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.workspaceSubBtn, { backgroundColor: '#5856D6' }]} onPress={() => setActiveView('wardrobe')}>
                <Briefcase size={20} color="white" />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.workspaceSubBtn, { backgroundColor: '#FF9500' }]} onPress={() => setActiveView('bucket')}>
                <ActivityIcon category="activity" size={26} color="white" />
              </TouchableOpacity>
            </MotiView>
          )}
        </AnimatePresence>
        <TouchableOpacity 
          activeOpacity={0.9} 
          onPress={() => setIsWorkspaceMenuOpen(!isWorkspaceMenuOpen)}
          style={[styles.workspaceMainFab, { backgroundColor: isWorkspaceMenuOpen ? '#333' : theme.tint }]}
        >
          <MotiView animate={{ rotate: isWorkspaceMenuOpen ? '45deg' : '0deg' }}>
            <Plus size={28} color="white" />
          </MotiView>
        </TouchableOpacity>
      </View>

      {/* Sub-Views Modals */}
      <Modal visible={activeView === 'finance'} animationType="slide">
        <TripFinance tripId={tripId} trip={{ title: 'Our Trip' }} onClose={() => setActiveView('map')} />
      </Modal>

      <Modal visible={activeView === 'wardrobe'} animationType="slide">
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          <View style={[styles.modalHeader, { paddingTop: insets.top + 20 }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Trip Wardrobe</Text>
            <TouchableOpacity onPress={() => setActiveView('map')}><X size={28} color={theme.text} /></TouchableOpacity>
          </View>
          <Wardrobe userId={userId} tripId={tripId} />
        </View>
      </Modal>

      <Modal visible={activeView === 'bucket'} animationType="slide">
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          <View style={[styles.modalHeader, { paddingTop: insets.top + 20 }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Bucket List</Text>
            <TouchableOpacity onPress={() => setActiveView('map')}><X size={28} color={theme.text} /></TouchableOpacity>
          </View>
          <Bucket tripId={tripId} mapRef={mapRef} onMarkersChange={onMarkersChange} />
        </View>
      </Modal>

      {selectedDay && (
        <Modal visible={!!selectedDay} animationType="slide">
          <DayDetails tripId={tripId} day={selectedDay} onClose={() => setSelectedDay(null)} isReadOnly={isReadOnly} />
        </Modal>
      )}
    </View>
  );
}

import { useMemo } from 'react';

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject },
  floatingHeader: { position: 'absolute', top: 0, left: 0, right: 0, height: 110, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, zIndex: 1000 },
  headerBack: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  headerInfo: { marginLeft: 15 },
  headerSubtitle: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  headerTitle: { fontSize: 20, fontWeight: '900' },
  workspaceFabContainer: { position: 'absolute', right: 20, alignItems: 'center', zIndex: 5000 },
  workspaceFabSubMenu: { gap: 15, marginBottom: 15, alignItems: 'center' },
  workspaceSubBtn: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', elevation: 5, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 5 },
  workspaceMainFab: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', elevation: 10, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 25, paddingBottom: 20 },
  modalTitle: { fontSize: 24, fontWeight: '900' },
});

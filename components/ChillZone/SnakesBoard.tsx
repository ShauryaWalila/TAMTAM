import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions, Image, Modal } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS, withSequence, withRepeat } from 'react-native-reanimated';
import Svg, { Rect, G, Path, Circle, Line, Text as SvgText, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { Maximize2, Minimize2, Dice5, Trophy, Swords, User, RefreshCw } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { MotiView, AnimatePresence } from 'moti';
import { BlurView } from 'expo-blur';
import { supabase } from '@/lib/supabase';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BOARD_SIZE = SCREEN_WIDTH - 40;
const FULL_BOARD_SIZE = SCREEN_WIDTH - 20;
const GRID_SIZE = 10;

const COLORS = {
  RED: '#FF2D55',
  GREEN: '#34C759',
  WOOD: '#8B4513',
  SNAKE: '#FF3B30',
};

const LADDERS: { [key: number]: number } = { 2: 38, 7: 14, 8: 31, 15: 26, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 78: 98, 87: 94 };
const SNAKES: { [key: number]: number } = { 16: 6, 46: 25, 49: 11, 62: 19, 64: 60, 74: 53, 89: 68, 92: 88, 95: 75, 99: 80 };

export default function SnakesBoard({ item, currentUserId, onMove }: any) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRolling, setIsRolling] = useState(false);
  const [lastRoll, setLastRoll] = useState(0);
  const diceAnim = useSharedValue(0);

  const turn = item.content?.turn;
  const winnerId = item.content?.winner;
  const isMyTurn = !turn || turn === currentUserId;
  const p1Pos = item.content?.p1 || 1;
  const p2Pos = item.content?.p2 || 1;

  useEffect(() => { if (turn === currentUserId) setLastRoll(0); }, [turn]);

  const rollDice = () => {
    if (!isMyTurn || winnerId || isRolling || lastRoll > 0) return;
    setIsRolling(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    diceAnim.value = withSequence(
      withRepeat(withTiming(1, { duration: 80 }), 6, true),
      withTiming(0, { duration: 100 }, (f) => {
        if (f) {
          const roll = Math.floor(Math.random() * 6) + 1;
          runOnJS(finishRoll)(roll);
        }
      })
    );
  };

  const finishRoll = (roll: number) => {
    setLastRoll(roll);
    setIsRolling(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => {
      onMove(roll);
      setLastRoll(0);
    }, 800);
  };

  const BoardContent = ({ size }: { size: number }) => {
    const cellSize = size / GRID_SIZE;
    const getXY = (pos: number) => {
      'worklet';
      const adjustedPos = pos - 1;
      const row = Math.floor(adjustedPos / GRID_SIZE);
      const col = adjustedPos % GRID_SIZE;
      const x = row % 2 === 0 ? col : (GRID_SIZE - 1 - col);
      const y = GRID_SIZE - 1 - row;
      return { x: x * cellSize + cellSize/2, y: y * cellSize + cellSize/2 };
    };

    return (
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Defs>
            <SvgGradient id="gradSnake" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor="#FF3B30" /><Stop offset="100%" stopColor="#8E0000" />
            </SvgGradient>
          </Defs>
          {[...Array(100)].map((_, i) => {
            const pos = i + 1;
            const { x, y } = getXY(pos);
            return (<G key={i}><Rect x={x - cellSize/2} y={y - cellSize/2} width={cellSize} height={cellSize} fill={((Math.floor((pos-1)/10) + (pos-1)) % 2 === 0) ? '#f9f9f9' : '#fff'} stroke="#eee" /><SvgText x={x - cellSize/2 + 5} y={y - cellSize/2 + 12} fontSize="8" fill="#ccc">{pos}</SvgText></G>);
          })}
          {Object.entries(LADDERS).map(([start, end]) => {
            const s = getXY(parseInt(start)), e = getXY(end);
            const angle = Math.atan2(e.y - s.y, e.x - s.x), dist = Math.sqrt((e.x-s.x)**2 + (e.y-s.y)**2), rOff = 6;
            return (<G key={`l-${start}`} transform={`rotate(${angle * (180/Math.PI)}, ${s.x}, ${s.y})`}><Line x1={s.x} y1={s.y - rOff} x2={s.x + dist} y2={s.y - rOff} stroke={COLORS.WOOD} strokeWidth="3" strokeLinecap="round" /><Line x1={s.x} y1={s.y + rOff} x2={s.x + dist} y2={s.y + rOff} stroke={COLORS.WOOD} strokeWidth="3" strokeLinecap="round" />{[...Array(Math.floor(dist/15))].map((_, i) => (<Line key={i} x1={s.x + (i+1)*15} y1={s.y - rOff} x2={s.x + (i+1)*15} y2={s.y + rOff} stroke={COLORS.WOOD} strokeWidth="2" />))}</G>);
          })}
          {Object.entries(SNAKES).map(([start, end]) => {
            const s = getXY(parseInt(start)), e = getXY(end);
            return (<G key={`s-${start}`}><Path d={`M ${s.x} ${s.y} Q ${(s.x+e.x)/2 + 30} ${(s.y+e.y)/2 - 20} ${e.x} ${e.y}`} stroke="url(#gradSnake)" strokeWidth="8" fill="none" strokeLinecap="round" opacity={0.8} /><Circle cx={s.x} cy={s.y} r="6" fill="#8E0000" /><Circle cx={s.x - 2} cy={s.y - 2} r="1.5" fill="white" /><Circle cx={s.x + 2} cy={s.y - 2} r="1.5" fill="white" /></G>);
          })}
          <Pawn pos={p1Pos} color={COLORS.RED} cellSize={cellSize} getXY={getXY} />
          <Pawn pos={p2Pos} color={COLORS.GREEN} cellSize={cellSize} getXY={getXY} offset />
        </Svg>
      </View>
    );
  };

  const UIHeader = () => (
    <View style={styles.header}>
      {/* 👤 PLAYER 1 (LEFT) */}
      <View style={styles.playerInfo}>
        <MotiView animate={{ scale: turn === 'pratishth' ? 1.1 : 1 }} style={[styles.avatarGlow, turn === 'pratishth' && { backgroundColor: COLORS.RED + '20' }]}>
          <View style={[styles.avatar, { backgroundColor: COLORS.RED }]}>
            <User size={16} color="white" />
          </View>
        </MotiView>
        <Text style={[styles.playerLabel, { color: COLORS.RED }]}>{currentUserId === 'pratishth' ? 'YOU' : 'TAMTAM'}</Text>
      </View>

      {/* 🎲 DICE (CENTER) */}
      <TouchableOpacity onPress={rollDice} style={styles.diceOuter} activeOpacity={0.8}>
        <Animated.View style={[useAnimatedStyle(() => ({ transform: [{ rotate: `${diceAnim.value * 360}deg` }, { scale: 1 + diceAnim.value * 0.2 }] }))]}>
          <Text style={styles.diceVal}>{isRolling ? '?' : (lastRoll || '🎲')}</Text>
        </Animated.View>
      </TouchableOpacity>

      {/* 👤 PLAYER 2 (RIGHT) */}
      <View style={[styles.playerInfo, { justifyContent: 'flex-end' }]}>
        <Text style={[styles.playerLabel, { color: COLORS.GREEN, textAlign: 'right' }]}>{currentUserId === 'love' ? 'YOU' : 'TAMTAM'}</Text>
        <MotiView animate={{ scale: turn === 'love' ? 1.1 : 1 }} style={[styles.avatarGlow, turn === 'love' && { backgroundColor: COLORS.GREEN + '20' }]}>
          <View style={[styles.avatar, { backgroundColor: COLORS.GREEN }]}>
            <User size={16} color="white" />
          </View>
        </MotiView>
      </View>
    </View>
  );

  if (winnerId) {
    return (
      <View style={styles.victoryBox}>
        <MotiView from={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} style={styles.victoryContent}>
          <Image 
            source={winnerId === currentUserId ? require('@/assets/images/Winning.gif') : require('@/assets/images/losing.gif')} 
            style={styles.victoryGif} 
          />
          <View style={{ alignItems: 'center', gap: 10 }}>
            <Text style={styles.victoryTitle}>MATCH COMPLETE</Text>
            <Text style={[styles.victoryWinner, { color: winnerId === currentUserId ? COLORS.GREEN : COLORS.RED }]}>
              {winnerId === currentUserId ? 'YOU WON! 🏆' : 'TAMTAM WON! 👑'}
            </Text>
          </View>
          <TouchableOpacity 
            style={styles.rematchBtn} 
            onPress={async () => await supabase.from('chill_items').update({ content: { players: { p1: 1, p2: 1 }, winner: null, turn: 'pratishth', chat: item.content.chat || [] } }).eq('id', item.id)}
          >
            <RefreshCw size={18} color="white" />
            <Text style={styles.rematchText}>REMATCH</Text>
          </TouchableOpacity>
        </MotiView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <UIHeader />
      <View style={styles.boardWrapper}>
        <BoardContent size={BOARD_SIZE} />
        <TouchableOpacity style={styles.expandBtn} onPress={() => setIsExpanded(true)}>
          <Maximize2 size={18} color="#888" />
        </TouchableOpacity>
      </View>

      <Modal visible={isExpanded} animationType="fade">
        <BlurView intensity={100} tint="light" style={StyleSheet.absoluteFill}>
          <View style={[styles.fullScreenContainer, { paddingTop: 60 }]}>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setIsExpanded(false)}><Minimize2 size={24} color="#000" /></TouchableOpacity>
            <UIHeader />
            <View style={styles.fullBoardBox}><BoardContent size={FULL_BOARD_SIZE} /></View>
            <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} style={styles.turnIndicator}>
              <Swords size={20} color={isMyTurn ? COLORS.RED : '#888'} />
              <Text style={styles.turnText}>{isMyTurn ? "IT'S YOUR TURN" : "TAMTAM'S MOVE"}</Text>
            </MotiView>
          </View>
        </BlurView>
      </Modal>
    </View>
  );
}

function Pawn({ pos, color, cellSize, getXY, offset }: any) {
  const { x, y } = getXY(pos);
  const animStyle = useAnimatedStyle(() => ({ left: withTiming(x - (cellSize * 0.25) + (offset ? 5 : -5), { duration: 400 }), top: withTiming(y - (cellSize * 0.25), { duration: 400 }) }));
  return (<Animated.View style={[styles.pawn, { backgroundColor: color, width: cellSize * 0.5, height: cellSize * 0.5, borderRadius: cellSize * 0.25 }, animStyle]} />);
}

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingHorizontal: 15, marginBottom: 20, alignItems: 'center' },
  playerInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  avatarGlow: { padding: 4, borderRadius: 20 },
  avatar: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', elevation: 2 },
  playerLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  diceOuter: { width: 70, height: 70, backgroundColor: '#000', borderRadius: 20, justifyContent: 'center', alignItems: 'center', elevation: 15 },
  diceVal: { color: 'white', fontSize: 32, fontWeight: '900' },
  boardWrapper: { width: BOARD_SIZE, height: BOARD_SIZE, backgroundColor: 'white', borderRadius: 15, overflow: 'hidden', borderWidth: 3, borderColor: '#333', elevation: 5 },
  expandBtn: { position: 'absolute', bottom: 10, right: 10, padding: 8, backgroundColor: 'rgba(255,255,255,0.8)', borderRadius: 10 },
  fullScreenContainer: { flex: 1, alignItems: 'center', padding: 10 },
  fullBoardBox: { width: FULL_BOARD_SIZE, height: FULL_BOARD_SIZE, backgroundColor: 'white', borderRadius: 20, overflow: 'hidden', elevation: 20, marginVertical: 30, borderWidth: 3, borderColor: '#333' },
  closeBtn: { position: 'absolute', top: 50, right: 20, zIndex: 100 },
  turnIndicator: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 15, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.05)' },
  turnText: { fontWeight: '900', fontSize: 14, letterSpacing: 1 },
  pawn: { position: 'absolute', borderWidth: 2, borderColor: 'white', elevation: 5 },
  victoryBox: { width: BOARD_SIZE, height: BOARD_SIZE + 100, alignItems: 'center', justifyContent: 'center', gap: 20, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.05)', overflow: 'hidden' },
  victoryGif: { width: 200, height: 200, borderRadius: 20 },
  victoryText: { fontSize: 24, fontWeight: '900' },
  rematchBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 30, paddingVertical: 15, backgroundColor: '#000', borderRadius: 20 },
  rematchText: { color: 'white', fontWeight: '900', fontSize: 16 }
});

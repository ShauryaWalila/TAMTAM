import React, { useState, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions, ActivityIndicator, Alert, Image } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS, withSequence, withRepeat } from 'react-native-reanimated';
import Svg, { Rect, G, Path, Circle, Polygon } from 'react-native-svg';
import { Star, User, Swords, Info, Trophy, RefreshCw } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { MotiView, AnimatePresence } from 'moti';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { supabase } from '@/lib/supabase';

const { width } = Dimensions.get('window');
const BOARD_SIZE = width - 40;
const CELL_SIZE = BOARD_SIZE / 15;

const COLORS = {
  RED: '#FF2D55',
  GREEN: '#34C759',
  BLUE: '#007AFF',
  YELLOW: '#FFCC00',
  SAFE: '#E5E5EA',
  EMPTY: '#F2F2F7',
};

const TRACK_COORDS = [
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0], [7, 0], [8, 0],
  [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6], [14, 7], [14, 8],
  [13, 8], [12, 8], [11, 8], [10, 8], [9, 8], [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14], [7, 14], [6, 14],
  [6, 13], [6, 12], [6, 11], [6, 10], [6, 9], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8], [0, 7], [0, 6]
];

const START_OFFSETS: any = { p1: 0, p2: 26 };
const HOME_PATHS: any = {
  p1: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
  p2: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]]
};

const SAFE_INDICES = [0, 8, 13, 21, 26, 34, 39, 47];

export default function LudoBoard({ item, currentUserId, onMove }: any) {
  const [diceRoll, setDiceRoll] = useState(0);
  const [isRolling, setIsRolling] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const diceAnim = useSharedValue(0);

  const players = useMemo(() => {
    const c = item.content || {};
    return {
      p1: c.players?.p1 || c.p1 || [0, 0, 0, 0],
      p2: c.players?.p2 || c.p2 || [0, 0, 0, 0]
    };
  }, [item.content]);

  const turn = item.content?.turn;
  const winnerId = item.content?.winner;
  const isMyTurn = !turn || turn === currentUserId;

  const occupancyMap = useMemo(() => {
    const map: { [key: string]: string[] } = {};
    const processPlayer = (pKey: string, pPawns: number[]) => {
      pPawns.forEach((pos, idx) => {
        if (pos > 0 && pos < 57) {
          const coords = getGridCoords(pos, pKey as any, idx);
          const gridKey = `${coords.x}-${coords.y}`;
          if (!map[gridKey]) map[gridKey] = [];
          map[gridKey].push(`${pKey}-${idx}`);
        }
      });
    };
    processPlayer('p1', players.p1);
    processPlayer('p2', players.p2);
    return map;
  }, [players]);

  function getGridCoords(pos: number, player: 'p1' | 'p2', pawnIdx?: number) {
    if (pos === 0) {
      const offsetX = player === 'p1' ? 0 : 9;
      const offsetY = player === 'p1' ? 0 : 9;
      const idx = pawnIdx || 0;
      return { x: offsetX + (idx < 2 ? 2 : 4), y: offsetY + (idx % 2 === 0 ? 2 : 4) };
    }
    let coords;
    if (pos <= 51) {
      const offset = START_OFFSETS[player];
      const index = (pos - 1 + offset) % 52;
      const safeIndex = index < 0 ? index + 52 : index;
      coords = TRACK_COORDS[safeIndex];
    } else {
      coords = HOME_PATHS[player][Math.min(pos - 52, 5)] || [7.5, 7.5];
    }
    return { x: coords[0], y: coords[1] };
  }

  useEffect(() => { if (turn === currentUserId) setDiceRoll(0); }, [turn, currentUserId]);

  const rollDice = () => {
    if (!isMyTurn || winnerId || isRolling || diceRoll > 0) return;
    setIsRolling(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    diceAnim.value = withSequence(withRepeat(withTiming(1, { duration: 80 }), 6, true), withTiming(0, { duration: 100 }, (f) => { if (f) runOnJS(finishRoll)(Math.floor(Math.random() * 6) + 1); }));
  };

  const finishRoll = (roll: number) => {
    setDiceRoll(roll);
    setIsRolling(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const pKey = currentUserId === 'pratishth' ? 'p1' : 'p2';
    if (!players[pKey].some((pos: number) => (pos === 0 ? roll === 6 : pos + roll <= 57))) {
      setStatusMsg("No legal moves!");
      setTimeout(() => { onMove(-1, roll); setDiceRoll(0); setStatusMsg(null); }, 1500);
    }
  };

  const handlePawnClick = (pKeyToMove: 'p1' | 'p2', pawnIdx: number) => {
    if (diceRoll === 0 || isRolling || winnerId) return;
    const myPKey = currentUserId === 'pratishth' ? 'p1' : 'p2';
    const targetPawns = players[pKeyToMove];
    const currentPos = targetPawns[pawnIdx];
    const canMoveThisPawn = currentPos === 0 ? diceRoll === 6 : currentPos + diceRoll <= 57;

    if (!canMoveThisPawn || !isMyTurn || pKeyToMove !== myPKey) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    onMove(pawnIdx, diceRoll);
    setDiceRoll(0);
  };

  const renderBase = (x: number, y: number, color: string) => (
    <G key={`base-${color}`}>
      <Rect x={x * CELL_SIZE} y={y * CELL_SIZE} width={CELL_SIZE * 6} height={CELL_SIZE * 6} fill={color} rx={12} />
      <Rect x={(x + 1) * CELL_SIZE} y={(y + 1) * CELL_SIZE} width={CELL_SIZE * 4} height={CELL_SIZE * 4} fill="white" rx={8} />
      {[0, 1, 2, 3].map(i => (<Circle key={i} cx={CELL_SIZE * (x + (i < 2 ? 2 : 4))} cy={CELL_SIZE * (y + (i % 2 === 0 ? 2 : 4))} r={CELL_SIZE * 0.6} fill={color} opacity={0.2} />))}
    </G>
  );

  return (
    <View style={styles.container}>
      <AnimatePresence>
        {winnerId ? (
          <MotiView key="victory" from={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} style={styles.victoryOverlay}>
            <BlurView intensity={20} tint="light" style={StyleSheet.absoluteFill} />
            <MotiView from={{ translateY: 50 }} animate={{ translateY: 0 }} style={styles.victoryContent}>
              <Image source={winnerId === currentUserId ? require('@/assets/images/Winning.gif') : require('@/assets/images/losing.gif')} style={styles.victoryGif} />
              <Text style={styles.victoryTitle}>MATCH COMPLETE</Text>
              <Text style={[styles.victoryWinner, { color: winnerId === currentUserId ? COLORS.GREEN : COLORS.RED }]}>{winnerId === currentUserId ? 'YOU WON! 🎉' : 'TAMTAM WON! 👑'}</Text>
              <TouchableOpacity onPress={async () => await supabase.from('chill_items').update({ content: { players: { p1: [0,0,0,0], p2: [0,0,0,0] }, winner: null, turn: 'pratishth', chat: item.content.chat || [] } }).eq('id', item.id)} style={styles.rematchBtn}>
                <RefreshCw size={20} color="white" /><Text style={styles.rematchText}>PLAY AGAIN</Text>
              </TouchableOpacity>
            </MotiView>
          </MotiView>
        ) : (
          <MotiView key="game" from={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ width: '100%', alignItems: 'center' }}>
            <View style={styles.bannerWrapper}>
              <AnimatePresence>
                {statusMsg ? (
                  <MotiView from={{ translateY: -50, opacity: 0 }} animate={{ translateY: 0, opacity: 1 }} exit={{ translateY: -50, opacity: 0 }} style={styles.statusBanner}><Info size={16} color="white" /><Text style={styles.statusText}>{statusMsg}</Text></MotiView>
                ) : (
                  <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} style={[styles.turnBanner, { backgroundColor: isMyTurn ? COLORS.RED : '#888' }]}>
                    <LinearGradient colors={isMyTurn ? [COLORS.RED, '#FF2D55'] : ['#888', '#555']} start={{x:0, y:0}} end={{x:1, y:0}} style={StyleSheet.absoluteFill} />
                    <Swords size={18} color="white" /><Text style={styles.turnBannerText}>{isMyTurn ? "IT'S YOUR TURN" : "TAMTAM'S MOVE"}</Text>
                  </MotiView>
                )}
              </AnimatePresence>
            </View>

            <View style={styles.playersRow}>
              <View style={styles.playerInfo}><MotiView from={{ scale: 1 }} animate={{ scale: turn === 'pratishth' ? 1.1 : 1 }} transition={{ loop: true }} style={[styles.avatarGlow, { backgroundColor: COLORS.RED + '20' }]}><View style={[styles.avatar, { backgroundColor: COLORS.RED }]}><User size={16} color="white" /></View></MotiView><Text style={[styles.playerLabel, { color: COLORS.RED }]}>{currentUserId === 'pratishth' ? 'YOU' : 'TAMTAM'}</Text></View>
              <TouchableOpacity onPress={rollDice} style={styles.diceOuter}><Animated.View style={[styles.dice, useAnimatedStyle(() => ({ transform: [{ rotate: `${diceAnim.value * 360}deg` }, { scale: 1 + diceAnim.value * 0.2 }] }))]}><Text style={styles.diceVal}>{isRolling ? '?' : (diceRoll || '🎲')}</Text></Animated.View></TouchableOpacity>
              <View style={[styles.playerInfo, { alignItems: 'flex-end' }]}><MotiView from={{ scale: 1 }} animate={{ scale: turn === 'love' ? 1.1 : 1 }} transition={{ loop: true }} style={[styles.avatarGlow, { backgroundColor: COLORS.GREEN + '20' }]}><View style={[styles.avatar, { backgroundColor: COLORS.GREEN }]}><User size={16} color="white" /></View></MotiView><Text style={[styles.playerLabel, { color: COLORS.GREEN }]}>{currentUserId === 'love' ? 'YOU' : 'TAMTAM'}</Text></View>
            </View>

            <View style={styles.boardWrapper}>
              <Svg width={BOARD_SIZE} height={BOARD_SIZE} viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`}>
                <Rect x={0} y={0} width={BOARD_SIZE} height={BOARD_SIZE} fill={COLORS.EMPTY} />
                {renderBase(0, 0, COLORS.RED)}
                {renderBase(9, 0, COLORS.YELLOW)}
                {renderBase(0, 9, COLORS.BLUE)}
                {renderBase(9, 9, COLORS.GREEN)}
                <G>
                  {[...Array(15)].map((_, y) => [...Array(15)].map((_, x) => {
                    const isPath = TRACK_COORDS.some(c => c[0] === x && c[1] === y) || HOME_PATHS.p1.some((c:any) => c[0] === x && c[1] === y) || HOME_PATHS.p2.some((c:any) => c[0] === x && c[1] === y);
                    if (!isPath) return null;
                    const isSafe = SAFE_INDICES.some(idx => TRACK_COORDS[idx][0] === x && TRACK_COORDS[idx][1] === y);
                    let fill = 'white';
                    if (isSafe) {
                      const safeIdx = SAFE_INDICES.find(idx => TRACK_COORDS[idx][0] === x && TRACK_COORDS[idx][1] === y);
                      if (safeIdx === 0) fill = COLORS.RED;
                      else if (safeIdx === 13) fill = COLORS.YELLOW;
                      else if (safeIdx === 26) fill = COLORS.GREEN;
                      else if (safeIdx === 39) fill = COLORS.BLUE;
                      else fill = COLORS.SAFE;
                    }
                    const isRedHome = HOME_PATHS.p1.some((c:any) => c[0] === x && c[1] === y);
                    const isGreenHome = HOME_PATHS.p2.some((c:any) => c[0] === x && c[1] === y);
                    if (isRedHome) fill = COLORS.RED;
                    if (isGreenHome) fill = COLORS.GREEN;
                    return (<G key={`${x}-${y}`}><Rect x={x*CELL_SIZE} y={y*CELL_SIZE} width={CELL_SIZE} height={CELL_SIZE} fill={fill} stroke="#DDD" strokeWidth={0.5} />{isSafe && <G transform={`translate(${x*CELL_SIZE + 4}, ${y*CELL_SIZE + 4}) scale(${CELL_SIZE/32})`}><Path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill={fill === 'white' || fill === COLORS.SAFE ? "#AAA" : "white"} /></G>}</G>);
                  }))}
                </G>
                <Polygon points={`${CELL_SIZE*6},${CELL_SIZE*6} ${CELL_SIZE*9},${CELL_SIZE*6} ${CELL_SIZE*7.5},${CELL_SIZE*7.5}`} fill={COLORS.YELLOW} />
                <Polygon points={`${CELL_SIZE*9},${CELL_SIZE*6} ${CELL_SIZE*9},${CELL_SIZE*9} ${CELL_SIZE*7.5},${CELL_SIZE*7.5}`} fill={COLORS.GREEN} />
                <Polygon points={`${CELL_SIZE*6},${CELL_SIZE*9} ${CELL_SIZE*9},${CELL_SIZE*9} ${CELL_SIZE*7.5},${CELL_SIZE*7.5}`} fill={COLORS.BLUE} />
                <Polygon points={`${CELL_SIZE*6},${CELL_SIZE*6} ${CELL_SIZE*6},${CELL_SIZE*9} ${CELL_SIZE*7.5},${CELL_SIZE*7.5}`} fill={COLORS.RED} />
              </Svg>
              {players.p1.map((pos: number, i: number) => {
                const coords = getGridCoords(pos, 'p1', i);
                const crowd = occupancyMap[`${coords.x}-${coords.y}`] || [];
                return <Pawn key={`p1-${i}`} color={COLORS.RED} pos={pos} player="p1" index={i} crowd={crowd} onPress={() => handlePawnClick('p1', i)} />;
              })}
              {players.p2.map((pos: number, i: number) => {
                const coords = getGridCoords(pos, 'p2', i);
                const crowd = occupancyMap[`${coords.x}-${coords.y}`] || [];
                return <Pawn key={`p2-${i}`} color={COLORS.GREEN} pos={pos} player="p2" index={i} crowd={crowd} onPress={() => handlePawnClick('p2', i)} />;
              })}
            </View>
          </MotiView>
        )}
      </AnimatePresence>
    </View>
  );
}

function Pawn({ color, pos, player, index, crowd, onPress }: any) {
  const getCoords = () => {
    if (pos === 0) {
      const offsetX = player === 'p1' ? 0 : 9;
      const offsetY = player === 'p1' ? 0 : 9;
      return { x: (offsetX + (index < 2 ? 2 : 4)) * CELL_SIZE, y: (offsetY + (index % 2 === 0 ? 2 : 4)) * CELL_SIZE, scale: 0.7 };
    }
    let coords;
    if (pos <= 51) coords = TRACK_COORDS[(pos - 1 + START_OFFSETS[player]) % 52];
    else coords = HOME_PATHS[player][Math.min(pos - 52, 5)] || [7.5, 7.5];
    let x = (coords[0] + 0.5) * CELL_SIZE;
    let y = (coords[1] + 0.5) * CELL_SIZE;
    let scale = 1;
    if (crowd.length > 1) {
      scale = 0.65;
      const myCrowdIdx = crowd.indexOf(`${player}-${index}`);
      const offset = CELL_SIZE * 0.22;
      const posMap = [[-1,-1], [1,-1], [-1,1], [1,1]];
      const [ox, oy] = posMap[myCrowdIdx % 4];
      x += ox * offset;
      y += oy * offset;
    }
    return { x, y, scale };
  };
  const { x, y, scale } = getCoords();
  const animStyle = useAnimatedStyle(() => ({ left: withTiming(x - (CELL_SIZE * 0.4), { duration: 300 }), top: withTiming(y - (CELL_SIZE * 0.4), { duration: 300 }), transform: [{ scale: withTiming(scale) }] }));
  return (<Animated.View style={[styles.pawnWrap, animStyle]}><TouchableOpacity onPress={onPress} style={[styles.pawn, { backgroundColor: color }]}><View style={styles.pawnInner} /></TouchableOpacity></Animated.View>);
}

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center' },
  victoryOverlay: { width: BOARD_SIZE, height: BOARD_SIZE + 150, justifyContent: 'center', alignItems: 'center', borderRadius: 20, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.05)' },
  victoryContent: { alignItems: 'center', gap: 20, padding: 40 },
  victoryGif: { width: 200, height: 200, borderRadius: 20 },
  victoryTitle: { color: '#333', fontSize: 28, fontWeight: '900', letterSpacing: 2 },
  victoryWinner: { fontSize: 24, fontWeight: '800' },
  rematchBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 30, paddingVertical: 15, backgroundColor: '#000', borderRadius: 20, marginTop: 20 },
  rematchText: { color: 'white', fontWeight: '900', fontSize: 16 },
  bannerWrapper: { height: 50, width: '100%', justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
  turnBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 25, paddingVertical: 10, borderRadius: 25, overflow: 'hidden' },
  turnBannerText: { color: 'white', fontWeight: '900', fontSize: 13, letterSpacing: 1 },
  statusBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, backgroundColor: '#000' },
  statusText: { color: 'white', fontWeight: '800', fontSize: 12 },
  playersRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingHorizontal: 15, marginBottom: 20, alignItems: 'center' },
  playerInfo: { flex: 1, gap: 5 },
  avatarGlow: { padding: 4, borderRadius: 20 },
  avatar: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  playerLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  diceOuter: { width: 75, height: 75, backgroundColor: '#000', borderRadius: 22, justifyContent: 'center', alignItems: 'center', elevation: 15 },
  diceVal: { color: 'white', fontSize: 36, fontWeight: '900' },
  boardWrapper: { width: BOARD_SIZE, height: BOARD_SIZE, backgroundColor: 'white', borderRadius: 12, overflow: 'hidden', elevation: 5, borderWidth: 3, borderColor: '#333' },
  pawnWrap: { position: 'absolute', width: CELL_SIZE * 0.8, height: CELL_SIZE * 0.8, zIndex: 100 },
  pawn: { flex: 1, borderRadius: 100, borderWidth: 2, borderColor: 'white', elevation: 5, justifyContent: 'center', alignItems: 'center' },
  pawnInner: { width: '40%', height: '40%', borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.5)' }
});

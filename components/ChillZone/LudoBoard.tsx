import React, { useState, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions, ActivityIndicator, Alert } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS, withSequence, withRepeat } from 'react-native-reanimated';
import Svg, { Rect, G, Path, Circle, Polygon } from 'react-native-svg';
import { Star, User } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { MotiView } from 'moti';

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

const SAFE_INDICES = [1, 9, 14, 22, 27, 35, 40, 48];

export default function LudoBoard({ item, currentUserId, onMove }: any) {
  const [diceRoll, setDiceRoll] = useState(0);
  const [isRolling, setIsRolling] = useState(false);
  const diceAnim = useSharedValue(0);

  const players = useMemo(() => {
    const c = item.content || {};
    return {
      p1: c.players?.p1 || c.p1 || [0, 0, 0, 0],
      p2: c.players?.p2 || c.p2 || [0, 0, 0, 0]
    };
  }, [item.content]);

  const turn = item.content?.turn;
  const isMyTurn = !turn || turn === currentUserId;

  // 🔄 Sync with Database turn changes
  useEffect(() => {
    if (turn === currentUserId) {
      setDiceRoll(0); // Reset local dice for new turn
    }
  }, [turn, currentUserId]);

  const rollDice = () => {
    if (!isMyTurn || isRolling || item.content?.winner || diceRoll > 0) return;
    setIsRolling(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    
    // Explicit 0 to 1 to 0 sequence to ensure the worklet always finishes
    diceAnim.value = 0;
    diceAnim.value = withSequence(
      withRepeat(withTiming(1, { duration: 80 }), 6, true),
      withTiming(0, { duration: 100 }, (finished) => {
        if (finished) {
          const roll = Math.floor(Math.random() * 6) + 1;
          runOnJS(finishRoll)(roll);
        }
      })
    );
  };

  const finishRoll = (roll: number) => {
    setDiceRoll(roll);
    setIsRolling(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    
    const pKey = currentUserId === 'pratishth' ? 'p1' : 'p2';
    const myPawns = players[pKey];
    const canMove = myPawns.some((pos: number) => (pos === 0 ? roll === 6 : pos + roll <= 57));

    if (!canMove) {
      setTimeout(() => {
        Alert.alert("No Moves!", "Passing turn automatically...");
        onMove(-1, roll);
        setDiceRoll(0);
      }, 1500);
    }
  };

  const handlePawnClick = (pawnIdx: number) => {
    if (!isMyTurn || diceRoll === 0 || isRolling) {
      if (!isMyTurn) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    onMove(pawnIdx, diceRoll);
    setDiceRoll(0);
  };

  const renderBase = (x: number, y: number, color: string) => (
    <G key={`base-${color}`}>
      <Rect x={x * CELL_SIZE} y={y * CELL_SIZE} width={CELL_SIZE * 6} height={CELL_SIZE * 6} fill={color} rx={12} />
      <Rect x={(x + 1) * CELL_SIZE} y={(y + 1) * CELL_SIZE} width={CELL_SIZE * 4} height={CELL_SIZE * 4} fill="white" rx={8} />
      {[0, 1, 2, 3].map(i => (
        <Circle key={i} cx={CELL_SIZE * (x + (i < 2 ? 2 : 4))} cy={CELL_SIZE * (y + (i % 2 === 0 ? 2 : 4))} r={CELL_SIZE * 0.6} fill={color} opacity={0.3} />
      ))}
    </G>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.playerTag}>
          <View style={[styles.avatar, { backgroundColor: COLORS.RED }]}><User size={16} color="white" /></View>
          <View><Text style={styles.playerName}>Pratishth</Text><Text style={[styles.playerColor, { color: COLORS.RED }]}>RED</Text></View>
          {turn === 'pratishth' && <MotiView from={{scale:0.8}} animate={{scale:1}} transition={{loop:true}} style={styles.turnDot} />}
        </View>

        <TouchableOpacity onPress={rollDice} style={styles.diceOuter} activeOpacity={0.7}>
          <Animated.View style={[styles.dice, useAnimatedStyle(() => ({ transform: [{ rotate: `${diceAnim.value * 360}deg` }, { scale: 1 + diceAnim.value * 0.2 }] }))]}>
            <Text style={styles.diceVal}>{isRolling ? '?' : (diceRoll || '🎲')}</Text>
          </Animated.View>
        </TouchableOpacity>

        <View style={[styles.playerTag, { alignItems: 'flex-end' }]}>
          <View style={{ alignItems: 'flex-end' }}><Text style={styles.playerName}>Supriya</Text><Text style={[styles.playerColor, { color: COLORS.GREEN }]}>GREEN</Text></View>
          <View style={[styles.avatar, { backgroundColor: COLORS.GREEN }]}><User size={16} color="white" /></View>
          {turn === 'love' && <MotiView from={{scale:0.8}} animate={{scale:1}} transition={{loop:true}} style={styles.turnDotLeft} />}
        </View>
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
              const isOnCommonPath = TRACK_COORDS.some(c => c[0] === x && c[1] === y);
              const isOnRedHome = HOME_PATHS.p1.some((c:any) => c[0] === x && c[1] === y);
              const isOnGreenHome = HOME_PATHS.p2.some((c:any) => c[0] === x && c[1] === y);
              const isSafe = SAFE_INDICES.some(idx => TRACK_COORDS[idx][0] === x && TRACK_COORDS[idx][1] === y);
              if (!isOnCommonPath && !isOnRedHome && !isOnGreenHome) return null;
              let fill = 'white';
              if (isOnRedHome) fill = COLORS.RED;
              if (isOnGreenHome) fill = COLORS.GREEN;
              if (isSafe) fill = COLORS.SAFE;
              return (
                <G key={`${x}-${y}`}>
                  <Rect x={x*CELL_SIZE} y={y*CELL_SIZE} width={CELL_SIZE} height={CELL_SIZE} fill={fill} stroke="#DDD" strokeWidth={0.5} />
                  {isSafe && <G transform={`translate(${x*CELL_SIZE + 4}, ${y*CELL_SIZE + 4}) scale(${CELL_SIZE/32})`}><Path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="#AAA" /></G>}
                </G>
              );
            }))}
          </G>
          <Polygon points={`${CELL_SIZE*6},${CELL_SIZE*6} ${CELL_SIZE*9},${CELL_SIZE*6} ${CELL_SIZE*7.5},${CELL_SIZE*7.5}`} fill={COLORS.YELLOW} />
          <Polygon points={`${CELL_SIZE*9},${CELL_SIZE*6} ${CELL_SIZE*9},${CELL_SIZE*9} ${CELL_SIZE*7.5},${CELL_SIZE*7.5}`} fill={COLORS.GREEN} />
          <Polygon points={`${CELL_SIZE*6},${CELL_SIZE*9} ${CELL_SIZE*9},${CELL_SIZE*9} ${CELL_SIZE*7.5},${CELL_SIZE*7.5}`} fill={COLORS.BLUE} />
          <Polygon points={`${CELL_SIZE*6},${CELL_SIZE*6} ${CELL_SIZE*6},${CELL_SIZE*9} ${CELL_SIZE*7.5},${CELL_SIZE*7.5}`} fill={COLORS.RED} />
        </Svg>

        {players.p1?.map((pos: number, i: number) => (
          <Pawn key={`p1-${i}`} color={COLORS.RED} pos={pos} player="p1" index={i} onPress={() => turn === 'pratishth' && handlePawnClick(i)} />
        ))}
        {players.p2?.map((pos: number, i: number) => (
          <Pawn key={`p2-${i}`} color={COLORS.GREEN} pos={pos} player="p2" index={i} onPress={() => turn === 'love' && handlePawnClick(i)} />
        ))}
      </View>
    </View>
  );
}

function Pawn({ color, pos, player, index, onPress }: any) {
  const getCoords = () => {
    if (pos === 0) {
      const offsetX = player === 'p1' ? 0 : 9;
      const offsetY = player === 'p1' ? 0 : 9;
      return { x: (offsetX + (index < 2 ? 2 : 4)) * CELL_SIZE, y: (offsetY + (index % 2 === 0 ? 2 : 4)) * CELL_SIZE };
    }
    let coords;
    if (pos <= 51) {
      const offset = START_OFFSETS[player];
      coords = TRACK_COORDS[(pos - 1 + offset) % 52];
    } else {
      coords = HOME_PATHS[player][Math.min(pos - 52, 5)] || [7.5, 7.5];
    }
    return { x: coords[0] * CELL_SIZE, y: coords[1] * CELL_SIZE };
  };

  const { x, y } = getCoords();
  const animStyle = useAnimatedStyle(() => ({
    left: withSpring(x - (CELL_SIZE * 0.4)),
    top: withSpring(y - (CELL_SIZE * 0.4)),
    transform: [{ scale: withSpring(pos === 0 ? 0.8 : 1) }]
  }));

  return (
    <Animated.View style={[styles.pawnWrap, animStyle]}>
      <TouchableOpacity onPress={onPress} style={[styles.pawn, { backgroundColor: color }]}>
        <View style={styles.pawnInner} />
      </TouchableOpacity>
    </Animated.View>
  );
}

function interpolate(val: number, inRange: number[], outRange: number[]) {
  'worklet';
  if (val <= inRange[0]) return outRange[0];
  if (val >= inRange[1]) return outRange[1];
  return outRange[0] + (val - inRange[0]) * (outRange[1] - outRange[0]) / (inRange[1] - inRange[0]);
}

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingHorizontal: 10, marginBottom: 20, alignItems: 'center' },
  playerTag: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  avatar: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  playerName: { fontWeight: '900', fontSize: 12, color: '#333' },
  playerColor: { fontSize: 8, fontWeight: 'bold' },
  diceOuter: { width: 70, height: 70, backgroundColor: '#000', borderRadius: 20, justifyContent: 'center', alignItems: 'center', elevation: 15 },
  diceVal: { color: 'white', fontSize: 32, fontWeight: '900' },
  boardWrapper: { width: BOARD_SIZE, height: BOARD_SIZE, backgroundColor: 'white', borderRadius: 12, overflow: 'hidden', elevation: 5, borderWidth: 3, borderColor: '#333' },
  pawnWrap: { position: 'absolute', width: CELL_SIZE * 0.8, height: CELL_SIZE * 0.8, zIndex: 100 },
  pawn: { flex: 1, borderRadius: 100, borderWidth: 2, borderColor: 'white', elevation: 5, justifyContent: 'center', alignItems: 'center' },
  pawnInner: { width: '40%', height: '40%', borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.5)' },
  turnDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.RED, marginLeft: 5 },
  turnDotLeft: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.GREEN, marginRight: 5 }
});

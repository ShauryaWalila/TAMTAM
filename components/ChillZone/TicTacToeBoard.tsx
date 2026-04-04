import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions, Image } from 'react-native';
import { RefreshCw, Bug, Swords, User } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { MotiView, AnimatePresence } from 'moti';
import { supabase } from '@/lib/supabase';

const { width } = Dimensions.get('window');
const BOARD_SIZE = width - 60;
const CELL_SIZE = BOARD_SIZE / 3;

const COLORS = {
  X: '#FF2D55',
  O: '#34C759',
  DRAW: '#8E8E93'
};

export default function TicTacToeBoard({ item, currentUserId, onMove }: any) {
  const [debugControl, setDebugControl] = useState<'none' | 'me' | 'partner'>('none');
  
  const board = item.content?.board || Array(9).fill(null);
  const turn = item.content?.turn;
  const winnerId = item.content?.winner;
  const isDraw = !winnerId && board.every((c: any) => c !== null);
  const isMyTurn = turn === currentUserId;

  const handleCellClick = (idx: number) => {
    if (board[idx] || winnerId || isDraw) return;
    const isSimulating = debugControl !== 'none';
    if (!isSimulating && !isMyTurn) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    let symbol = currentUserId === 'pratishth' ? 'X' : 'O';
    let targetPKey = currentUserId;
    if (debugControl === 'partner') {
      symbol = currentUserId === 'pratishth' ? 'O' : 'X';
      targetPKey = currentUserId === 'pratishth' ? 'love' : 'pratishth';
    } else if (debugControl === 'me') {
      symbol = currentUserId === 'pratishth' ? 'X' : 'O';
      targetPKey = currentUserId;
    }
    onMove(idx, symbol, targetPKey, isSimulating);
  };

  const UIHeader = () => (
    <View style={styles.header}>
      <View style={[styles.playerTag, turn === 'pratishth' && styles.activeTag]}>
        <View style={[styles.avatar, { backgroundColor: COLORS.X }]}><User size={12} color="white" /></View>
        <Text style={[styles.playerLabel, { color: COLORS.X }]}>{currentUserId === 'pratishth' ? 'YOU' : 'TAMTAM'}</Text>
      </View>
      <View style={styles.vsBox}><Text style={styles.vsText}>VS</Text></View>
      <View style={[styles.playerTag, turn === 'love' && styles.activeTag, { flexDirection: 'row-reverse' }]}>
        <View style={[styles.avatar, { backgroundColor: COLORS.O }]}><User size={12} color="white" /></View>
        <Text style={[styles.playerLabel, { color: COLORS.O }]}>{currentUserId === 'love' ? 'YOU' : 'TAMTAM'}</Text>
      </View>
    </View>
  );

  if (winnerId || isDraw) {
    const iWon = winnerId === currentUserId;
    return (
      <View style={styles.container}>
        <View style={styles.victoryBox}>
          <MotiView 
            from={{ opacity: 0, scale: 0.8 }} 
            animate={{ opacity: 1, scale: 1 }} 
            style={styles.victoryContent}
          >
            <Image 
              source={isDraw ? require('@/assets/images/losing.gif') : (iWon ? require('@/assets/images/Winning.gif') : require('@/assets/images/losing.gif'))} 
              style={styles.victoryGif}
              resizeMode="cover"
            />
            <View style={{ alignItems: 'center', gap: 10 }}>
              <Text style={styles.victoryTitle}>{isDraw ? "IT'S A DRAW!" : "MATCH COMPLETE"}</Text>
              {!isDraw && (
                <Text style={[styles.victoryWinner, { color: iWon ? COLORS.O : COLORS.X }]}>
                  {iWon ? 'YOU WON! 🏆' : 'TAMTAM WON! 👑'}
                </Text>
              )}
            </View>
            <TouchableOpacity 
              onPress={async () => await supabase.from('chill_items').update({ content: { board: Array(9).fill(null), turn: 'pratishth', winner: null, chat: item.content.chat || [] } }).eq('id', item.id)}
              style={styles.rematchBtn}
            >
              <RefreshCw size={18} color="white" />
              <Text style={styles.rematchText}>PLAY AGAIN</Text>
            </TouchableOpacity>
          </MotiView>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity 
        onPress={() => setDebugControl(p => p === 'none' ? 'me' : p === 'me' ? 'partner' : 'none')}
        style={[styles.debugBtn, debugControl !== 'none' && { backgroundColor: '#FF9500' }]}
      >
        <Bug size={12} color={debugControl !== 'none' ? "white" : "#666"} />
        <Text style={[styles.debugBtnText, debugControl !== 'none' && { color: 'white' }]}>
          {debugControl === 'none' ? 'DEBUG OFF' : debugControl === 'me' ? 'PLACE MINE' : 'PLACE TAMTAM'}
        </Text>
      </TouchableOpacity>

      <UIHeader />

      <View style={styles.grid}>
        {board.map((cell: any, i: number) => (
          <TouchableOpacity key={i} onPress={() => handleCellClick(i)} style={styles.cell} activeOpacity={0.7}>
            <AnimatePresence>
              {cell && (
                <MotiView from={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={styles.markWrap}>
                  <Text style={[styles.cellText, { color: cell === 'X' ? COLORS.X : COLORS.O }]}>{cell}</Text>
                </MotiView>
              )}
            </AnimatePresence>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.footer}>
        <Swords size={16} color={isMyTurn ? COLORS.X : '#888'} />
        <Text style={[styles.turnText, { color: isMyTurn ? '#333' : '#888' }]}>{isMyTurn ? "YOUR TURN" : "TAMTAM'S MOVE"}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', alignItems: 'center', paddingVertical: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'center', marginBottom: 20, paddingHorizontal: 10 },
  playerTag: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 12, opacity: 0.5 },
  activeTag: { opacity: 1, backgroundColor: 'rgba(0,0,0,0.05)' },
  avatar: { width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  playerLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  vsBox: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  vsText: { color: 'white', fontSize: 10, fontWeight: '900' },
  grid: { width: BOARD_SIZE, height: BOARD_SIZE, flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#eee', borderRadius: 15, overflow: 'hidden', borderWidth: 2, borderColor: '#333' },
  cell: { width: CELL_SIZE, height: CELL_SIZE, backgroundColor: '#fff', borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#eee', justifyContent: 'center', alignItems: 'center' },
  markWrap: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' },
  cellText: { fontSize: 48, fontWeight: '900' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.03)' },
  turnText: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  debugBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.05)', alignSelf: 'flex-start', marginBottom: 15 },
  debugBtnText: { fontSize: 10, fontWeight: '900', color: '#666' },
  
  // 🏆 VICTORY BOX
  victoryBox: { 
    width: BOARD_SIZE, 
    height: BOARD_SIZE + 100, 
    alignItems: 'center', 
    justifyContent: 'center', 
    borderRadius: 20, 
    backgroundColor: 'rgba(0,0,0,0.05)', 
    overflow: 'hidden',
    padding: 20
  },
  victoryContent: { 
    alignItems: 'center', 
    justifyContent: 'center',
    gap: 20,
    width: '100%'
  },
  victoryGif: { 
    width: 200, 
    height: 200, 
    borderRadius: 20 
  },
  victoryTitle: { 
    fontSize: 26, 
    fontWeight: '900', 
    color: '#333',
    textAlign: 'center'
  },
  victoryWinner: { 
    fontSize: 20, 
    fontWeight: '800', 
    textAlign: 'center' 
  },
  rematchBtn: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 8, 
    paddingHorizontal: 25, 
    paddingVertical: 12, 
    backgroundColor: '#000', 
    borderRadius: 15, 
    marginTop: 10 
  },
  rematchText: { 
    color: 'white', 
    fontWeight: '900' 
  }
});
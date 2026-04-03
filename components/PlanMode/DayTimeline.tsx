import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { format, isSameDay } from 'date-fns';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { supabase } from '@/lib/supabase';

interface DayTimelineProps {
  days: any[];
  activeDayIndex: number;
  onDayPress: (index: number) => void;
  tripId?: string;
}

export default function DayTimeline({ days, activeDayIndex, onDayPress, tripId }: DayTimelineProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  // 🛡️ Safety Check: If days aren't loaded yet, show a loader
  if (!days || days.length === 0) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator color={theme.tint} size="small" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {days.map((day, index) => {
          const isSelected = activeDayIndex === index;
          
          return (
            <TouchableOpacity
              key={index}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onDayPress(index);
              }}
              style={[
                styles.dayCard,
                { backgroundColor: theme.card },
                isSelected && { borderColor: theme.tint, borderWidth: 2 }
              ]}
            >
              <Text style={[styles.dayLabel, { color: isSelected ? theme.tint : theme.tabIconDefault }]}>
                DAY {day.dayNumber || index + 1}
              </Text>
              <Text style={[styles.dateText, { color: theme.text }]}>
                {day.date ? format(new Date(day.date), 'dd MMM') : 'TBD'}
              </Text>
              <Text style={[styles.weekdayText, { color: theme.tabIconDefault }]}>
                {day.weekday || ''}
              </Text>
              
              {isSelected && (
                <MotiView 
                  layout={{ type: 'spring' }}
                  style={[styles.activeIndicator, { backgroundColor: theme.tint }]} 
                />
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 110, marginBottom: 10 },
  loaderContainer: { height: 110, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { paddingHorizontal: 20, gap: 12, alignItems: 'center' },
  dayCard: {
    width: 85,
    height: 90,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 5,
  },
  dayLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  dateText: { fontSize: 16, fontWeight: '800', marginTop: 4 },
  weekdayText: { fontSize: 10, fontWeight: '600', marginTop: 2 },
  activeIndicator: {
    position: 'absolute',
    bottom: 8,
    width: 20,
    height: 3,
    borderRadius: 2,
  }
});

import React from 'react';
import { View, StyleSheet } from 'react-native';
import LottieView from 'lottie-react-native';
import { Camera } from 'lucide-react-native';

const activityLottie = require('@/assets/lottie/activity.lottie');

interface ActivityIconProps {
  category: string;
  size?: number;
  color?: string;
}

export default function ActivityIcon({ category, size = 16, color }: ActivityIconProps) {
  if (category === 'activity') {
    return (
      <View style={{ 
        width: size + 15, 
        height: size + 15, 
        justifyContent: 'center', 
        alignItems: 'center',
        backgroundColor: 'white',
        borderRadius: (size + 15) / 2
      }}>
        <LottieView
          source={activityLottie}
          autoPlay
          loop
          style={{ width: size * 3, height: size * 3 }}
        />
      </View>
    );
  }

  return <Camera size={size} color={color} />;
}

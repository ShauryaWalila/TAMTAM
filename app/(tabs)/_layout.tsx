import React from 'react';
import { Tabs } from 'expo-router';
import RadialNavigator from '@/components/RadialNavigator';

export default function TabLayout() {
  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' }, // Hide default tab bar
        }}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="journal" />
        <Tabs.Screen name="our-life" />
        <Tabs.Screen name="finance" />
        <Tabs.Screen name="motm" options={{ href: null }} />
        <Tabs.Screen name="next-meet" options={{ href: null }} />
        <Tabs.Screen name="wishlist" />
        <Tabs.Screen name="chill-zone" />
        <Tabs.Screen name="settings" />
      </Tabs>
      
      {/* 🎡 Custom Floating Navigator */}
      <RadialNavigator />
    </>
  );
}

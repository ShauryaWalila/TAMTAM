import { Stack } from 'expo-router';

export default function StudyLayout() {
  return (
    <Stack screenOptions={{ 
      headerShown: false, 
      animation: 'slide_from_bottom',
      gestureEnabled: false 
    }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="deck/[id]" />
      <Stack.Screen name="whiteboard/[id]" />
    </Stack>
  );
}

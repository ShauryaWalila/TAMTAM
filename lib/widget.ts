import { Platform } from 'react-native';

// Dynamically import to prevent crash in Expo Go where native module doesn't exist
let ExpoWidgets: any = null;
try {
  ExpoWidgets = require('@bittingz/expo-widgets');
} catch (e) {
  // Module not found or not in a native build
}

function isWidgetAvailable() {
  return Platform.OS === 'ios' && ExpoWidgets && ExpoWidgets.setWidgetData;
}

/**
 * Updates the Drawing Widget
 */
export function updateDrawingWidget(imageUrl: string) {
  if (!isWidgetAvailable()) {
    console.log('Drawing Widget: Native module not available');
    return;
  }
  ExpoWidgets.setWidgetData({
    type: 'drawing',
    drawingUrl: imageUrl
  });
}

/**
 * Updates the Touch Widget
 */
export function updateTouchWidget(message: string) {
  if (!isWidgetAvailable()) {
    console.log('Touch Widget: Native module not available');
    return;
  }
  ExpoWidgets.setWidgetData({
    type: 'touch',
    touchMessage: message,
    touchTimestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });
}

/**
 * Updates the Distance Widget
 */
export function updateDistanceWidget(km: string, locationName: string) {
  if (!isWidgetAvailable()) return;
  ExpoWidgets.setWidgetData({
    type: 'distance',
    distanceKm: km,
    partnerLocationName: locationName
  });
}

/**
 * Updates the Meeting Widget
 */
export function updateMeetingWidget(days: string, title: string) {
  if (!isWidgetAvailable()) return;
  ExpoWidgets.setWidgetData({
    type: 'meeting',
    daysUntilMeeting: days,
    meetingTitle: title
  });
}

/**
 * Updates the Routine Widget
 */
export function updateRoutineWidget(next: string, time: string, items: any[] = []) {
  if (!isWidgetAvailable()) return;
  ExpoWidgets.setWidgetData({
    type: 'routine',
    nextActivity: next,
    nextActivityTime: time,
    routineItemsJson: JSON.stringify(items)
  });
}

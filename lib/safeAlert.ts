// Safe Alert wrapper for use inside React Native <Modal> contexts.
//
// iOS bug: calling Alert.alert() while a <Modal> is still presented throws
// NSException from UIAlertController -> ObjC re-throws -> app SIGABRT.
//
// Usage pattern (inside a modal/sheet):
//   safeAlert(
//     () => setShowOptions(null),   // dismiss your modal first
//     'Title',
//     'Message',
//     [
//       { text: 'Cancel', style: 'cancel' },
//       { text: 'Delete', style: 'destructive', onPress: () => doDelete() },
//     ],
//   );

import { Alert, AlertButton } from 'react-native';

export function safeAlert(
  dismissModal: (() => void) | null,
  title: string,
  message?: string,
  buttons?: AlertButton[],
  delayMs: number = 250
): void {
  if (dismissModal) dismissModal();
  setTimeout(() => {
    try {
      Alert.alert(title, message, buttons);
    } catch (e) {
      console.warn('safeAlert failed', e);
    }
  }, delayMs);
}

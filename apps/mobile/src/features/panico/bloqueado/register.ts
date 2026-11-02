import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import {
  expireLockedPanicArm,
  handleLockedPanicResponse,
  recordLockedPanicFailure,
} from './notification';

// SDK 57 explicitly delivers Android action taps while backgrounded or terminated:
// https://docs.expo.dev/versions/v57.0.0/sdk/notifications/#registertaskasynctaskname
if (Platform.OS === 'android') {
  const taskName = 'garita-locked-panic';
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(taskName, async ({ data }) => {
    const keepAliveMs = await handleLockedPanicResponse(data).catch(recordLockedPanicFailure);
    // SDK 57 TaskService pauses timers when the last task resolves; do not await network confirmation.
    if (keepAliveMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, keepAliveMs));
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        // Wait for publication, including any timer reconciliation already queued, with a bounded exit.
        await Promise.race([
          expireLockedPanicArm().catch(recordLockedPanicFailure),
          new Promise<void>((resolve) => {
            timeout = setTimeout(resolve, 2000);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    }
  });
  void Notifications.registerTaskAsync(taskName).catch(recordLockedPanicFailure);
}

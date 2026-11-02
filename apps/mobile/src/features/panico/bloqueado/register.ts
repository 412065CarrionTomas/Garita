import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { handleLockedPanicResponse, recordLockedPanicFailure } from './notification';

// SDK 57 explicitly delivers Android action taps while backgrounded or terminated:
// https://docs.expo.dev/versions/v57.0.0/sdk/notifications/#registertaskasynctaskname
if (Platform.OS === 'android') {
  const taskName = 'garita-locked-panic';
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(taskName, async ({ data }) => {
    await handleLockedPanicResponse(data).catch(recordLockedPanicFailure);
  });
  void Notifications.registerTaskAsync(taskName).catch(recordLockedPanicFailure);
}

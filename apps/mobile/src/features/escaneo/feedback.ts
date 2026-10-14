import * as Haptics from 'expo-haptics';
import { createAudioPlayer } from 'expo-audio';

let feedbackOverride: (() => Promise<void>) | undefined;

export function setFeedbackForTesting(override?: () => Promise<void>): void {
  feedbackOverride = override;
}

let audioPlayer: ReturnType<typeof createAudioPlayer> | null = null;

export async function playSuccessFeedback(): Promise<void> {
  if (feedbackOverride) {
    await feedbackOverride();
    return;
  }

  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Haptics not available or unsupported
  }

  try {
    if (!audioPlayer) {
      audioPlayer = createAudioPlayer(require('../../../assets/sounds/nfc-confirmation.wav'));
    }
    audioPlayer.play();
  } catch {
    // Audio not available or mocked
  }
}

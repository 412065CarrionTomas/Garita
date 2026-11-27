import { createAudioPlayer } from 'expo-audio';
import { playSuccessFeedback } from './feedback';

const mockPlayer = { seekTo: jest.fn(() => Promise.resolve()), play: jest.fn() };
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn(() => mockPlayer) }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success' },
}));

it('rebobina el sonido antes de cada confirmación para que suene siempre', async () => {
  await playSuccessFeedback();
  await playSuccessFeedback();
  // Un solo reproductor reutilizado, rebobinado antes de cada reproducción.
  expect(createAudioPlayer).toHaveBeenCalledTimes(1);
  expect(mockPlayer.seekTo).toHaveBeenCalledTimes(2);
  expect(mockPlayer.play).toHaveBeenCalledTimes(2);
  expect(mockPlayer.seekTo.mock.invocationCallOrder[1]).toBeLessThan(
    mockPlayer.play.mock.invocationCallOrder[1] ?? 0,
  );
});

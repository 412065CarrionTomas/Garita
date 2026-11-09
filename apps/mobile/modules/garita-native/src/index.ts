import { requireNativeModule, type EventSubscription } from 'expo-modules-core';
import type { NativeLocation, NativeModuleCapabilities, MonotonicClock } from '@garita/shared';

export interface GaritaNativeModule {
  getSmsCapability(): Promise<{ canSendInBackground: boolean }>;
  sendSms(input: { destination: string; message: string }): Promise<{ id: string }>;
  addListener(name: 'onSmsStatus', listener: (event: unknown) => void): EventSubscription;
  getMonotonicClock(): Promise<MonotonicClock>;
  getCurrentLocation(options: { timeoutMs: number }): Promise<NativeLocation>;
  getCapabilities(): Promise<NativeModuleCapabilities>;
}
export default requireNativeModule<GaritaNativeModule>('GaritaNative');

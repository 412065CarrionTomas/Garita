import { requireNativeModule } from 'expo-modules-core';
import type { NativeLocation, NativeModuleCapabilities, MonotonicClock } from '@garita/shared';

export interface GaritaNativeModule {
  getMonotonicClock(): Promise<MonotonicClock>;
  getCurrentLocation(options: { timeoutMs: number }): Promise<NativeLocation>;
  getCapabilities(): Promise<NativeModuleCapabilities>;
}
export default requireNativeModule<GaritaNativeModule>('GaritaNative');

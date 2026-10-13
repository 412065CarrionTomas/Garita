import { requireNativeModule } from 'expo-modules-core';
import type { NativeLocation, NativeModuleCapabilities } from '@garita/shared';

export interface GaritaNativeModule {
  getCurrentLocation(options: { timeoutMs: number }): Promise<NativeLocation>;
  getCapabilities(): Promise<NativeModuleCapabilities>;
}
export default requireNativeModule<GaritaNativeModule>('GaritaNative');

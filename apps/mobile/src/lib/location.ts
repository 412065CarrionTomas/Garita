import { NativeModulesProxy, requireNativeModule } from 'expo-modules-core';
import {
  nativeLocationSchema,
  type NativeLocation,
  type NativeModuleCapabilities,
} from '@garita/shared';

interface GaritaNativeModule {
  getCurrentLocation(options: { timeoutMs: number }): Promise<unknown>;
  getCapabilities(): Promise<NativeModuleCapabilities>;
}

function loadModule(): GaritaNativeModule {
  if (!NativeModulesProxy.GaritaNative)
    return requireNativeModule<GaritaNativeModule>('GaritaNative');
  return NativeModulesProxy.GaritaNative as GaritaNativeModule;
}

export class LocationError extends Error {
  constructor(
    readonly code: 'PERMISSION_DENIED' | 'LOCATION_TIMEOUT' | 'LOCATION_UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'LocationError';
  }
}

let moduleOverride: GaritaNativeModule | undefined;
export function setNativeLocationModuleForTesting(module: GaritaNativeModule | undefined): void {
  moduleOverride = module;
}

export async function getCurrentLocation(
  options: { timeoutMs?: number } = {},
): Promise<NativeLocation> {
  const timeoutMs = Math.min(options.timeoutMs ?? 5000, 5000);
  const nativeModule = moduleOverride ?? loadModule();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      nativeModule.getCurrentLocation({ timeoutMs }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(
              new LocationError(
                'LOCATION_TIMEOUT',
                'No se obtuvo ubicación dentro del tiempo permitido.',
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
    return nativeLocationSchema.parse(result);
  } catch (error) {
    if (error instanceof LocationError) throw error;
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'PERMISSION_DENIED'
    )
      throw new LocationError('PERMISSION_DENIED', 'Se requiere permiso de ubicación precisa.');
    throw new LocationError('LOCATION_UNAVAILABLE', 'No se pudo obtener la ubicación.');
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function getLocationCapabilities(): Promise<NativeModuleCapabilities> {
  return (moduleOverride ?? loadModule()).getCapabilities();
}

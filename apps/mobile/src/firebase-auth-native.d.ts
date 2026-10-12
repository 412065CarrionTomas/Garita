import type { initializeAuth } from 'firebase/auth';

type NativeAuthDependencies = NonNullable<Parameters<typeof initializeAuth>[1]>;
type NativePersistence = NonNullable<NativeAuthDependencies['persistence']>;
type SinglePersistence = NativePersistence extends readonly (infer Item)[]
  ? Item
  : NativePersistence;

declare module 'firebase/auth' {
  /** Firebase expone esta función en el entrypoint React Native que selecciona Metro. */
  export function getReactNativePersistence(storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  }): SinglePersistence;
}

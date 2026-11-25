import Constants from 'expo-constants';
import { z } from 'zod';

/**
 * Variables públicas de la app. Expo incrusta en el bundle las EXPO_PUBLIC_*,
 * por eso se leen de a una y por nombre completo (nunca poner secretos).
 */
const envSchema = z.object({
  EXPO_PUBLIC_API_URL: z.url(),
  EXPO_PUBLIC_FIREBASE_API_KEY: z.string().min(1),
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1),
  EXPO_PUBLIC_FIREBASE_APP_ID: z.string().min(1),
});

const result = envSchema.safeParse({
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  EXPO_PUBLIC_FIREBASE_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
});

if (!result.success) {
  throw new Error(`Variables de entorno inválidas:\n${z.prettifyError(result.error)}`);
}

/**
 * En desarrollo, una API en localhost se busca en el host por el que el celular
 * llegó a Metro: por USB (adb reverse) sigue siendo localhost; por Wi-Fi o
 * hotspot pasa a ser la IP de la PC. Cualquier otra URL se respeta tal cual.
 */
export function resolveApiUrl(configured: string, metroHostUri: string | undefined) {
  const metroHost = metroHostUri?.split(':')[0];
  if (!metroHost) return configured;
  return configured.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/, `$1${metroHost}`);
}

export const env = {
  ...result.data,
  EXPO_PUBLIC_API_URL: __DEV__
    ? resolveApiUrl(result.data.EXPO_PUBLIC_API_URL, Constants.expoConfig?.hostUri)
    : result.data.EXPO_PUBLIC_API_URL,
};

import { z } from 'zod';

/**
 * Variables públicas de la app. Expo incrusta en el bundle las EXPO_PUBLIC_*,
 * por eso se leen de a una y por nombre completo (nunca poner secretos).
 */
const envSchema = z.object({
  EXPO_PUBLIC_API_URL: z.url(),
});

const result = envSchema.safeParse({
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
});

if (!result.success) {
  throw new Error(`Variables de entorno inválidas:\n${z.prettifyError(result.error)}`);
}

export const env = result.data;

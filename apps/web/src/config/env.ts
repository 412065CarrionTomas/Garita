import { z } from 'zod';

/** Variables públicas de Firebase y la API; nunca incluir secretos en Vite. */
const envSchema = z.object({
  VITE_API_URL: z.url(),
  VITE_FIREBASE_API_KEY: z.string().min(1),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  VITE_FIREBASE_PROJECT_ID: z.string().min(1),
  VITE_FIREBASE_APP_ID: z.string().min(1),
  VITE_GOOGLE_MAPS_API_KEY: z.string().optional().default(''),
});

const result = envSchema.safeParse(import.meta.env);

if (!result.success) {
  throw new Error(`Variables de entorno inválidas:\n${z.prettifyError(result.error)}`);
}

export const env = result.data;

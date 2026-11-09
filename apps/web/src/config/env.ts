import { z } from 'zod';

/** Variables públicas de Firebase y la API; nunca incluir secretos en Vite. */
const envSchema = z.object({
  VITE_API_URL: z.url(),
  VITE_FIREBASE_API_KEY: z.string().min(1),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  VITE_FIREBASE_PROJECT_ID: z.string().min(1),
  VITE_FIREBASE_APP_ID: z.string().min(1),
  VITE_FIREBASE_MESSAGING_SENDER_ID: z.string().optional().default(''),
  VITE_FIREBASE_VAPID_KEY: z.string().optional().default(''),
  VITE_GOOGLE_MAPS_API_KEY: z.string().optional().default(''),
  // Opcionales: solo se cargan para cambiar de proveedor (MapTiler, hosting propio, IGN).
  VITE_MAP_STYLE_URL: z.url().default('https://tiles.openfreemap.org/styles/positron'),
  VITE_GEOCODER_URL: z.url().default('https://photon.komoot.io/api/'),
});

const result = envSchema.safeParse(import.meta.env);

if (!result.success) {
  throw new Error(`Variables de entorno inválidas:\n${z.prettifyError(result.error)}`);
}

export const env = result.data;

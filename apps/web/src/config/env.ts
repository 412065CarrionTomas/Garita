import { z } from 'zod';

/** Variables de entorno públicas del panel (se incrustan en el build: nunca poner secretos). */
const envSchema = z.object({
  VITE_API_URL: z.url(),
});

const result = envSchema.safeParse(import.meta.env);

if (!result.success) {
  throw new Error(`Variables de entorno inválidas:\n${z.prettifyError(result.error)}`);
}

export const env = result.data;

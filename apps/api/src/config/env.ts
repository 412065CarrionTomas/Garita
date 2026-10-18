import { z } from 'zod';

/** Variables de entorno de la API. Se validan al iniciar: si falta alguna, la API no arranca. */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url())),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    WEB_APP_URL: z.url().default('http://localhost:5173'),
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM: z.string().optional(),
    FIREBASE_PROJECT_ID: z.string().min(1).optional(),
    FIREBASE_CLIENT_EMAIL: z.email().optional(),
    FIREBASE_PRIVATE_KEY: z.string().min(1).optional(),
    QR_SIGNING_SECRET: z.string().min(32).optional(),
    SHIFT_CREDENTIAL_SECRET: z.string().min(32).optional(),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV !== 'test') {
      for (const key of [
        'FIREBASE_PROJECT_ID',
        'FIREBASE_CLIENT_EMAIL',
        'FIREBASE_PRIVATE_KEY',
        'QR_SIGNING_SECRET',
        'SHIFT_CREDENTIAL_SECRET',
      ] as const) {
        if (!env[key])
          context.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} es obligatoria fuera de test`,
          });
      }
    }
  })
  .transform((env) => ({
    ...env,
    QR_SIGNING_SECRET:
      env.QR_SIGNING_SECRET ??
      (env.NODE_ENV === 'test' ? 'garita-test-qr-signing-secret-fixed-value' : undefined),
    SHIFT_CREDENTIAL_SECRET:
      env.SHIFT_CREDENTIAL_SECRET ??
      (env.NODE_ENV === 'test' ? 'garita-test-shift-credential-secret-fixed-value' : undefined),
  }));

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    throw new Error(`Variables de entorno inválidas:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}

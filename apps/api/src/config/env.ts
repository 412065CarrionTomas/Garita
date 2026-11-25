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
    SOCKET_REDIS_ADAPTER_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    WEB_APP_URL: z.url().default('http://localhost:5173'),
    // shortcut: destino temporal, se retira cuando HU-36/HU-37 confirme el destino.
    PANIC_SMS_DESTINATION_TYPE: z.enum(['PLATFORM_GATEWAY', 'GUARD_PHONE']).default('GUARD_PHONE'),
    PANIC_SMS_PLATFORM_NUMBER: z
      .string()
      .regex(/^\+[1-9]\d{1,14}$/)
      .optional(),
    RESEND_API_KEY: z.string().optional(),
    SMS_PROVIDER: z.enum(['log', 'http']).default('log'),
    SMS_GATEWAY_URL: z.url({ protocol: /^https?$/ }).optional(),
    SMS_GATEWAY_TOKEN: z.string().min(1).optional(),
    SMS_WEBHOOK_SECRET: z.string().min(32).optional(),
    RESEND_FROM: z.string().optional(),
    FIREBASE_PROJECT_ID: z.string().min(1).optional(),
    FIREBASE_CLIENT_EMAIL: z.email().optional(),
    FIREBASE_PRIVATE_KEY: z.string().min(1).optional(),
    QR_SIGNING_SECRET: z.string().min(32).optional(),
    NFC_MASTER_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{32}$/)
      .optional(),
    NFC_MASTER_KEY_VERSION: z.coerce.number().int().min(0).max(255).optional(),
    SHIFT_CREDENTIAL_SECRET: z.string().min(32).optional(),
    CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
    CLOUDINARY_API_KEY: z.string().min(1).optional(),
    CLOUDINARY_API_SECRET: z.string().min(1).optional(),
    MERCADOPAGO_ACCESS_TOKEN: z.string().min(1).optional(),
    MERCADOPAGO_WEBHOOK_SECRET: z.string().min(1).optional(),
    ORS_API_KEY: z.string().min(1).optional(),
    ORS_URL: z.url({ protocol: /^https?$/ }).default('https://api.heigit.org/openrouteservice'),
  })
  .superRefine((env, context) => {
    if (env.SMS_PROVIDER === 'http') {
      for (const key of ['SMS_GATEWAY_URL', 'SMS_GATEWAY_TOKEN'] as const)
        if (!env[key])
          context.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} es obligatoria con SMS_PROVIDER=http`,
          });
    }
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

import { validateEnv } from './env';

const REQUIRED = {
  DATABASE_URL: 'postgresql://garita:garita@localhost:5432/garita',
  REDIS_URL: 'redis://localhost:6379',
  FIREBASE_PROJECT_ID: 'garita-test',
  FIREBASE_CLIENT_EMAIL: 'firebase-test@example.invalid',
  FIREBASE_PRIVATE_KEY: 'fake-test-key',
  QR_SIGNING_SECRET: 'garita-production-like-signing-key-value',
};

describe('validateEnv', () => {
  it('aplica valores por defecto en desarrollo', () => {
    const env = validateEnv(REQUIRED);

    expect(env).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      CORS_ORIGINS: ['http://localhost:5173'],
      DATABASE_URL: REQUIRED.DATABASE_URL,
      REDIS_URL: REQUIRED.REDIS_URL,
      FIREBASE_PROJECT_ID: REQUIRED.FIREBASE_PROJECT_ID,
      FIREBASE_CLIENT_EMAIL: REQUIRED.FIREBASE_CLIENT_EMAIL,
      FIREBASE_PRIVATE_KEY: REQUIRED.FIREBASE_PRIVATE_KEY,
      QR_SIGNING_SECRET: REQUIRED.QR_SIGNING_SECRET,
    });
  });

  it('convierte el puerto a número y separa los orígenes de CORS', () => {
    const env = validateEnv({
      ...REQUIRED,
      PORT: '8080',
      CORS_ORIGINS: 'https://garita.app, https://staging.garita.app',
    });

    expect(env.PORT).toBe(8080);
    expect(env.CORS_ORIGINS).toEqual(['https://garita.app', 'https://staging.garita.app']);
  });

  it('falla si una variable tiene un valor inválido', () => {
    expect(() => validateEnv({ ...REQUIRED, NODE_ENV: 'staging' })).toThrow(
      'Variables de entorno inválidas',
    );
  });

  it('falla si un origen de CORS no es una URL', () => {
    expect(() => validateEnv({ ...REQUIRED, CORS_ORIGINS: 'no-es-una-url' })).toThrow();
  });

  it('exige DATABASE_URL con una URL de PostgreSQL', () => {
    expect(() => validateEnv({ REDIS_URL: REQUIRED.REDIS_URL })).toThrow('DATABASE_URL');
    expect(() => validateEnv({ ...REQUIRED, DATABASE_URL: 'mysql://localhost/garita' })).toThrow();
  });

  it('exige REDIS_URL con una URL de Redis', () => {
    expect(() => validateEnv({ DATABASE_URL: REQUIRED.DATABASE_URL })).toThrow('REDIS_URL');
    expect(() => validateEnv({ ...REQUIRED, REDIS_URL: 'http://localhost:6379' })).toThrow();
  });

  it('permite omitir la clave solo en test y exige al menos 32 caracteres en otros entornos', () => {
    const testEnv = validateEnv({ ...REQUIRED, NODE_ENV: 'test', QR_SIGNING_SECRET: undefined });
    expect(testEnv.QR_SIGNING_SECRET).toBe('garita-test-qr-signing-secret-fixed-value');
    expect(() => validateEnv({ ...REQUIRED, QR_SIGNING_SECRET: 'short' })).toThrow();
    const { QR_SIGNING_SECRET: _secret, ...withoutSecret } = REQUIRED;
    expect(() => validateEnv(withoutSecret)).toThrow('QR_SIGNING_SECRET');
  });
});

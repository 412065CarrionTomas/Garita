import { validateEnv } from './env';

const REQUIRED = {
  DATABASE_URL: 'postgresql://garita:garita@localhost:5432/garita',
  REDIS_URL: 'redis://localhost:6379',
  FIREBASE_PROJECT_ID: 'garita-test',
  FIREBASE_CLIENT_EMAIL: 'firebase-test@example.invalid',
  FIREBASE_PRIVATE_KEY: 'fake-test-key',
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
      WEB_APP_URL: 'http://localhost:5173',
      FIREBASE_PROJECT_ID: REQUIRED.FIREBASE_PROJECT_ID,
      FIREBASE_CLIENT_EMAIL: REQUIRED.FIREBASE_CLIENT_EMAIL,
      FIREBASE_PRIVATE_KEY: REQUIRED.FIREBASE_PRIVATE_KEY,
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
});

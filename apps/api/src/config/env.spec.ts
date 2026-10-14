import { validateEnv } from './env';

const REQUIRED = {
  DATABASE_URL: 'postgresql://garita:garita@localhost:5432/garita',
  REDIS_URL: 'redis://localhost:6379',
  FIREBASE_PROJECT_ID: 'garita-test',
  FIREBASE_CLIENT_EMAIL: 'firebase-test@example.invalid',
  FIREBASE_PRIVATE_KEY: 'fake-test-key',
  QR_SIGNING_SECRET: 'garita-production-like-signing-key-value',
  SHIFT_CREDENTIAL_SECRET: 'garita-production-shift-cred-secret-val',
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
      QR_SIGNING_SECRET: REQUIRED.QR_SIGNING_SECRET,
      SHIFT_CREDENTIAL_SECRET: REQUIRED.SHIFT_CREDENTIAL_SECRET,
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
    const testEnv = validateEnv({
      ...REQUIRED,
      NODE_ENV: 'test',
      QR_SIGNING_SECRET: undefined,
      SHIFT_CREDENTIAL_SECRET: undefined,
    });
    expect(testEnv.QR_SIGNING_SECRET).toBe('garita-test-qr-signing-secret-fixed-value');
    expect(testEnv.SHIFT_CREDENTIAL_SECRET).toBe('garita-test-shift-credential-secret-fixed-value');
    expect(() => validateEnv({ ...REQUIRED, QR_SIGNING_SECRET: 'short' })).toThrow();
    expect(() => validateEnv({ ...REQUIRED, SHIFT_CREDENTIAL_SECRET: 'short' })).toThrow();
    const { QR_SIGNING_SECRET: _secret, ...withoutQrSecret } = REQUIRED;
    expect(() => validateEnv(withoutQrSecret)).toThrow('QR_SIGNING_SECRET');
    const { SHIFT_CREDENTIAL_SECRET: _shiftSecret, ...withoutShiftSecret } = REQUIRED;
    expect(() => validateEnv(withoutShiftSecret)).toThrow('SHIFT_CREDENTIAL_SECRET');
  });

  it('solo usa el secreto QR de prueba cuando NODE_ENV es test', () => {
    const { QR_SIGNING_SECRET: _omit, ...withoutSecret } = REQUIRED;
    expect(validateEnv({ ...withoutSecret, NODE_ENV: 'test' }).QR_SIGNING_SECRET).toBeTruthy();
    expect(() => validateEnv({ ...withoutSecret, NODE_ENV: 'production' })).toThrow(
      'QR_SIGNING_SECRET',
    );
  });

  it('solo usa el secreto de credencial de turno de prueba cuando NODE_ENV es test', () => {
    const { SHIFT_CREDENTIAL_SECRET: _omit, ...withoutSecret } = REQUIRED;
    expect(
      validateEnv({ ...withoutSecret, NODE_ENV: 'test' }).SHIFT_CREDENTIAL_SECRET,
    ).toBeTruthy();
    expect(() => validateEnv({ ...withoutSecret, NODE_ENV: 'production' })).toThrow(
      'SHIFT_CREDENTIAL_SECRET',
    );
  });
});

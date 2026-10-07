import { validateEnv } from './env';

const REQUIRED = {
  DATABASE_URL: 'postgresql://garita:garita@localhost:5432/garita',
};

describe('validateEnv', () => {
  it('aplica valores por defecto en desarrollo', () => {
    const env = validateEnv(REQUIRED);

    expect(env).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      CORS_ORIGINS: ['http://localhost:5173'],
      DATABASE_URL: REQUIRED.DATABASE_URL,
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
    expect(() => validateEnv({})).toThrow('DATABASE_URL');
    expect(() => validateEnv({ DATABASE_URL: 'mysql://localhost/garita' })).toThrow();
  });
});

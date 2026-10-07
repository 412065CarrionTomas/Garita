import { validateEnv } from './env';

describe('validateEnv', () => {
  it('aplica valores por defecto en desarrollo', () => {
    const env = validateEnv({});

    expect(env).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      CORS_ORIGINS: ['http://localhost:5173'],
    });
  });

  it('convierte el puerto a número y separa los orígenes de CORS', () => {
    const env = validateEnv({
      PORT: '8080',
      CORS_ORIGINS: 'https://garita.app, https://staging.garita.app',
    });

    expect(env.PORT).toBe(8080);
    expect(env.CORS_ORIGINS).toEqual(['https://garita.app', 'https://staging.garita.app']);
  });

  it('falla si una variable tiene un valor inválido', () => {
    expect(() => validateEnv({ NODE_ENV: 'staging' })).toThrow('Variables de entorno inválidas');
  });

  it('falla si un origen de CORS no es una URL', () => {
    expect(() => validateEnv({ CORS_ORIGINS: 'no-es-una-url' })).toThrow();
  });
});

import { resolveApiUrl } from './env';

describe('resolveApiUrl', () => {
  const local = 'http://localhost:3000/api/v1';

  it('por Wi-Fi o hotspot usa la IP por la que se llegó a Metro', () => {
    expect(resolveApiUrl(local, '192.168.100.34:8081')).toBe('http://192.168.100.34:3000/api/v1');
    expect(resolveApiUrl('http://127.0.0.1:3000/api/v1', '10.0.0.7:8081')).toBe(
      'http://10.0.0.7:3000/api/v1',
    );
  });

  it('por USB sigue en localhost', () => {
    expect(resolveApiUrl(local, 'localhost:8081')).toBe(local);
  });

  it('sin Metro (build de release) deja la URL configurada', () => {
    expect(resolveApiUrl(local, undefined)).toBe(local);
  });

  it('no toca una API que no está en localhost', () => {
    const hosted = 'https://api.garita.com/api/v1';
    expect(resolveApiUrl(hosted, '192.168.100.34:8081')).toBe(hosted);
    expect(resolveApiUrl('http://localhost.example.com/api', '192.168.1.2:8081')).toBe(
      'http://localhost.example.com/api',
    );
  });
});

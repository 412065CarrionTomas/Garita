import { liveHealthResponseSchema } from './health';

describe('liveHealthResponseSchema', () => {
  it('acepta una respuesta válida', () => {
    const response = { status: 'ok', timestamp: new Date().toISOString() };

    expect(liveHealthResponseSchema.parse(response)).toEqual(response);
  });

  it('rechaza una fecha que no está en formato ISO 8601', () => {
    const result = liveHealthResponseSchema.safeParse({ status: 'ok', timestamp: 'ayer' });

    expect(result.success).toBe(false);
  });
});

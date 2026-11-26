import { listUsersQuerySchema } from './users';

describe('listUsersQuerySchema', () => {
  it('acepta solo los tamaños de página ofrecidos y usa 20 por defecto', () => {
    expect(listUsersQuerySchema.parse({}).porPagina).toBe(20);
    expect(listUsersQuerySchema.parse({ porPagina: '5' }).porPagina).toBe(5);
    expect(listUsersQuerySchema.safeParse({ porPagina: '7' }).success).toBe(false);
    expect(listUsersQuerySchema.safeParse({ porPagina: '1000' }).success).toBe(false);
  });
});

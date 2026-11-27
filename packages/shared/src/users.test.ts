import { searchTerms } from './pagination';
import { listUsersQuerySchema } from './users';

describe('listUsersQuerySchema', () => {
  it('acepta solo los tamaños de página ofrecidos y usa 20 por defecto', () => {
    expect(listUsersQuerySchema.parse({}).porPagina).toBe(20);
    expect(listUsersQuerySchema.parse({ porPagina: '5' }).porPagina).toBe(5);
    expect(listUsersQuerySchema.safeParse({ porPagina: '7' }).success).toBe(false);
    expect(listUsersQuerySchema.safeParse({ porPagina: '1000' }).success).toBe(false);
  });

  it('rechaza páginas que desbordarían el desplazamiento', () => {
    expect(listUsersQuerySchema.safeParse({ pagina: '1000000000' }).success).toBe(false);
  });
});

describe('searchTerms', () => {
  it('separa por espacios y se queda con 8 palabras como máximo', () => {
    expect(searchTerms('  bruno   paz ')).toEqual(['bruno', 'paz']);
    expect(searchTerms(undefined)).toEqual([]);
    expect(searchTerms('a b c d e f g h i j')).toHaveLength(8);
  });
});

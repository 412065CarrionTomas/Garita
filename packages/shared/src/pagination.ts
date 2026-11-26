import { z } from 'zod';

/** Tamaños de página que ofrecen los listados paginados en el backend. */
export const PAGE_SIZES = [3, 5, 10, 20, 50] as const;
export const pageSizeSchema = z.coerce
  .number()
  .pipe(z.union(PAGE_SIZES.map((size) => z.literal(size))))
  .default(20);

/** Página pedida; el tope evita que el desplazamiento desborde y la API responda 500. */
export const pageNumberSchema = z.coerce.number().int().min(1).max(100000).default(1);

/** Hasta 8 palabras de búsqueda: cada una suma un filtro por campo a la consulta. */
export const searchTerms = (buscar?: string) =>
  (buscar ?? '').split(/\s+/).filter(Boolean).slice(0, 8);

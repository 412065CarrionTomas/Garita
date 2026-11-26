import { z } from 'zod';

/** Tamaños de página que ofrecen los listados paginados en el backend. */
export const PAGE_SIZES = [3, 5, 10, 20, 50] as const;
export const pageSizeSchema = z.coerce
  .number()
  .pipe(z.union(PAGE_SIZES.map((size) => z.literal(size))))
  .default(20);

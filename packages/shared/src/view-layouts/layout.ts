import { z } from 'zod';

/** Límites duros de un diseño guardado: acotan el tamaño de la fila en la base y del body. */
export const LAYOUT_LIMITS = { maxItems: 50, maxColumns: 96, maxRows: 2000 } as const;

const cell = z.number().int().min(0).max(LAYOUT_LIMITS.maxRows);
const span = z.number().int().min(1).max(LAYOUT_LIMITS.maxRows);

/** Un bloque del diseño: posición y tamaño en celdas, si está oculto, cómo se presenta y sus ajustes. */
export const layoutItemSchema = z
  .object({
    id: z.string().min(1).max(64),
    x: cell,
    y: cell,
    w: span,
    h: span,
    hidden: z.boolean(),
    presentation: z.string().min(1).max(32),
    settings: z.record(z.string().max(32), z.unknown()),
  })
  .strict();

/**
 * Diseño de una pantalla. `version` es la del catálogo con que se armó: si el catálogo cambia,
 * el diseño se reconcilia al leerlo en lugar de romper la pantalla.
 */
export const viewLayoutSchema = z
  .object({
    version: z.number().int().min(1),
    items: z.array(layoutItemSchema).max(LAYOUT_LIMITS.maxItems),
  })
  .strict();

export type LayoutItem = z.infer<typeof layoutItemSchema>;
export type ViewLayout = z.infer<typeof viewLayoutSchema>;

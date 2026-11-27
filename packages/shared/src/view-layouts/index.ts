import { z } from 'zod';
import { adminSummaryCatalog } from './admin-summary';
import type { ViewCatalog } from './catalog';
import type { ViewKey } from './keys';
import { viewLayoutSchema } from './layout';

export * from './grid';
export * from './layout';
export * from './keys';
export * from './catalog';
export * from './admin-summary';

/** Catálogo de cada pantalla personalizable: la API valida contra él y la web lo dibuja. */
export const viewCatalogs: Readonly<Record<ViewKey, ViewCatalog>> = {
  'admin-summary': adminSummaryCatalog,
};

/** Máximo de entidades fijadas por pantalla y por tipo. */
export const MAX_FAVORITES = 50;

// --- Contratos de la API: /mis-preferencias/vistas/:vista ---

/** `layout` nulo: el usuario nunca guardó y se usa el diseño por defecto. */
export const viewPreferenceResponseSchema = z.object({
  layout: viewLayoutSchema.nullable(),
  updatedAt: z.iso.datetime().nullable(),
});

/**
 * `baseUpdatedAt` es la fecha del diseño que se editó (nula si no había ninguno guardado): si otra
 * pestaña guardó después, la API responde 409 en lugar de pisarlo. Lo comparten PUT y DELETE.
 */
export const viewPreferenceBaseSchema = z.iso.datetime().nullable();

/** En el DELETE la fecha base viaja en la query: `null` es el texto "null". */
export const VIEW_PREFERENCE_NO_BASE = 'null';

export const viewPreferenceInputSchema = z
  .object({ layout: viewLayoutSchema, baseUpdatedAt: viewPreferenceBaseSchema })
  .strict();

export type ViewPreferenceResponse = z.infer<typeof viewPreferenceResponseSchema>;
export type ViewPreferenceInput = z.infer<typeof viewPreferenceInputSchema>;

/** Código del 409 cuando el diseño cambió desde que se empezó a editar. */
export const VIEW_PREFERENCE_CONFLICT_CODE = 'view_preference_conflict';

// --- Contratos de la API: /mis-favoritos/:vista/:tipo ---

/** La lista completa de fijados, en orden: guardar reemplaza la anterior. */
export const favoritesInputSchema = z
  .object({
    ids: z
      .array(z.string().min(1).max(100))
      .max(MAX_FAVORITES)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'Hay elementos repetidos.' }),
  })
  .strict();

export const favoritesResponseSchema = z.object({ ids: z.array(z.string()) });

export type FavoritesInput = z.infer<typeof favoritesInputSchema>;
export type FavoritesResponse = z.infer<typeof favoritesResponseSchema>;

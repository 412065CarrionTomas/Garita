import { z } from 'zod';

/** Pantallas personalizables. Cada una tiene su catálogo en `index.ts`. */
export const VIEW_KEYS = ['admin-summary'] as const;
export const viewKeySchema = z.enum(VIEW_KEYS);
export type ViewKey = z.infer<typeof viewKeySchema>;

/** Entidades que un usuario puede fijar arriba de una lista, con su propio orden. */
export const FAVORITE_ENTITY_TYPES = ['site', 'guard', 'client'] as const;
export const favoriteEntityTypeSchema = z.enum(FAVORITE_ENTITY_TYPES);
export type FavoriteEntityType = z.infer<typeof favoriteEntityTypeSchema>;

import { z } from 'zod';

/** Normalizes the factory UID returned by NFC readers to uppercase hex without separators. */
export function normalizeNfcUid(value: string): string {
  const compact = value.replace(/[\s:-]/g, '').toUpperCase();
  if (
    !/^[0-9A-F]+$/.test(compact) ||
    compact.length < 8 ||
    compact.length > 20 ||
    compact.length % 2 !== 0
  )
    throw new Error('El identificador NFC no es válido');
  return compact;
}

export const nfcTagUidSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((value, ctx) => {
    try {
      return normalizeNfcUid(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'El identificador NFC no es válido' });
      return z.NEVER;
    }
  });
export const associateNfcTagSchema = z.object({
  uid: nfcTagUidSchema,
  confirmMove: z.boolean().optional().default(false),
});
export const includeNfcTagQuerySchema = z.object({
  incluirEtiqueta: z.enum(['true', 'false']).optional(),
});
export const nfcTagStatusSchema = z.enum(['active', 'replaced', 'removed']);
export const nfcTagSummarySchema = z.object({
  status: nfcTagStatusSchema,
  associatedAt: z.iso.datetime().or(z.date()),
  uid: z.string().optional(),
});
/** Predio del modo NFC con su avance: puntos activos y cuántos tienen etiqueta vigente. */
export const nfcConfigurationSiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  total: z.number().int().nonnegative(),
  tagged: z.number().int().nonnegative(),
});
export const nfcConfigurationSitesSchema = z.array(nfcConfigurationSiteSchema);
export type AssociateNfcTag = z.infer<typeof associateNfcTagSchema>;

export const identifyNfcTagSchema = z.object({ uid: nfcTagUidSchema });
/** A qué punto pertenece una etiqueta leída (la asociación más reciente). */
export const identifiedNfcTagSchema = z.object({
  status: nfcTagStatusSchema,
  kind: z.enum(['basic', 'secure']),
  associatedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  checkpoint: z.object({ id: z.string(), name: z.string(), position: z.number().int() }),
  site: z.object({ id: z.string(), name: z.string() }),
  /** Última vez que un vigilador la marcó; solo si sigue vigente. */
  lastReadAt: z.iso.datetime().nullable(),
});
export type IdentifiedNfcTag = z.infer<typeof identifiedNfcTagSchema>;

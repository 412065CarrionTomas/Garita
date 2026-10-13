import { z } from 'zod';

/** Normalizes the factory UID returned by NFC readers to uppercase hex without separators. */
export function normalizeNfcUid(value: string): string {
  const compact = value.replace(/[\s:-]/g, '').toUpperCase();
  if (!/^[0-9A-F]+$/.test(compact) || ![8, 14, 20].includes(compact.length))
    throw new Error('El identificador NFC no es válido');
  return compact;
}

export const nfcTagUidSchema = z.string().trim().min(1).max(64).transform(normalizeNfcUid);
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
export const nfcConfigurationSiteSchema = z.object({ id: z.string(), name: z.string() });
export const nfcConfigurationSitesSchema = z.array(nfcConfigurationSiteSchema);
export type AssociateNfcTag = z.infer<typeof associateNfcTagSchema>;

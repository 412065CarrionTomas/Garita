import { z } from 'zod';

const photonSchema = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }), // [lng, lat]
      properties: z.object({
        name: z.string().optional(),
        street: z.string().optional(),
        housenumber: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
      }),
    }),
  ),
});

export interface AddressSuggestion {
  label: string;
  latitude: number;
  longitude: number;
}

/** Respuesta de Photon (entrada externa) → sugerencias. Si no cumple el esquema, sin sugerencias. */
export function parsePhoton(body: unknown): AddressSuggestion[] {
  const result = photonSchema.safeParse(body);
  if (!result.success) return [];
  return result.data.features.map(({ geometry, properties: p }) => {
    const street = [p.street, p.housenumber].filter(Boolean).join(' ');
    const parts = [p.name, street, p.city, p.state].filter((part): part is string => Boolean(part));
    return {
      label: [...new Set(parts)].join(', ') || 'Ubicación sin nombre',
      latitude: geometry.coordinates[1],
      longitude: geometry.coordinates[0],
    };
  });
}

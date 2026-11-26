import { haversineMeters } from '@garita/shared';
import { z } from 'zod';
import { env } from '@/config/env';

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

/**
 * Calle y número del punto, solo si Photon encuentra un domicilio (con número) a no más de
 * `maxMeters`. Una calle sin número no alcanza: Photon devuelve la más cercana aunque el punto esté
 * en un descampado a 200 m, y la ubicación de su geometría no dice si el punto está sobre ella.
 */
export function parseStreetAddress(
  body: unknown,
  latitude: number,
  longitude: number,
  maxMeters: number,
): string | null {
  const result = photonSchema.safeParse(body);
  if (!result.success) return null;
  const nearest = result.data.features
    .flatMap(({ geometry, properties: p }) =>
      p.street && p.housenumber
        ? [
            {
              label: `${p.street} ${p.housenumber}`,
              meters: haversineMeters(
                latitude,
                longitude,
                geometry.coordinates[1],
                geometry.coordinates[0],
              ),
            },
          ]
        : [],
    )
    .sort((a, b) => a.meters - b.meters)[0];
  return nearest && nearest.meters <= maxMeters ? nearest.label : null;
}

/** A esta distancia de un domicilio, el punto está "en" esa dirección. */
const ADDRESS_MAX_METERS = 30;
const ADDRESS_TIMEOUT_MS = 4000;

/** Busca la calle y número del punto. Si Photon no responde o no hay domicilio cerca: null. */
export async function fetchStreetAddress(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  try {
    // Con barra final, "../reverse" queda junto a "api" aunque la URL tenga más tramos (proxy/photon/api).
    const url = new URL('../reverse', env.VITE_GEOCODER_URL.replace(/\/?$/, '/'));
    url.search = new URLSearchParams({
      lat: String(latitude),
      lon: String(longitude),
      limit: '10',
      radius: String(ADDRESS_MAX_METERS / 1000), // km
    }).toString();
    // Es un dato secundario: no puede trabar el guardado del punto si Photon no contesta.
    const res = await fetch(url, { signal: AbortSignal.timeout(ADDRESS_TIMEOUT_MS) });
    if (!res.ok) return null;
    return parseStreetAddress(await res.json(), latitude, longitude, ADDRESS_MAX_METERS);
  } catch {
    return null;
  }
}

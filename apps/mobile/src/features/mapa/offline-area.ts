import { OfflineManager } from '@maplibre/maplibre-react-native';
import { env } from '@/config/env';

type Bounds = [number, number, number, number];

/** Margen alrededor del recorrido (~300 m) para ver cómo se llega. */
const MARGIN = 0.003;
// Zoom de calle a portón: alcanza para orientarse sin bajar miles de teselas.
const MIN_ZOOM = 13;
const MAX_ZOOM = 17;

const pending = new Set<string>();

/**
 * Descarga una vez el mapa de la zona de una ronda para verlo sin señal. Si ya está descargada o
 * falla (sin red, sin espacio), sigue sin avisar: el mapa en línea funciona igual.
 */
export async function ensureOfflineArea(key: string, [west, south, east, north]: Bounds) {
  // Dos pantallas a la vez no descargan la misma zona dos veces.
  if (pending.has(key)) return;
  pending.add(key);
  try {
    const packs = await OfflineManager.getPacks();
    if (packs.some((pack) => pack.metadata?.key === key)) return;
    await OfflineManager.createPack(
      {
        mapStyle: env.EXPO_PUBLIC_MAP_STYLE_URL,
        bounds: [west - MARGIN, south - MARGIN, east + MARGIN, north + MARGIN],
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        metadata: { key },
      },
      () => undefined,
      () => undefined,
    );
  } catch {
    // Sin descarga queda el mapa en línea y lo que MapLibre ya tenga en su caché.
  } finally {
    pending.delete(key);
  }
}

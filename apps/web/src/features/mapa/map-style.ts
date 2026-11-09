import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { colors } from '@garita/tokens';
import { env } from '@/config/env';

interface Palette {
  land: string;
  park: string;
  water: string;
  bank: string;
  road: string;
  avenue: string;
  building: string;
  contour: string;
  label: string;
}

// Valores de maquetas/IMPLEMENTACION.md §6. Las etiquetas usan la tinta atenuada del tema.
const light: Palette = {
  land: '#EEF0F2',
  park: '#E0E8E4',
  water: '#D6E0EC',
  bank: '#E3E9F1',
  road: '#FFFFFF',
  avenue: '#FFFFFF',
  building: '#E1E5EA',
  contour: '#DFE3EA',
  label: colors.light.mutedForeground,
};
const dark: Palette = {
  land: '#121B2E',
  park: '#142A33',
  water: '#0C1322',
  bank: '#0F182A',
  road: '#1D2943',
  avenue: '#2B3A5C',
  building: '#182339',
  contour: '#1A2540',
  label: colors.dark.mutedForeground,
};

/** Centro por defecto de los mapas (ciudad de Córdoba) cuando todavía no hay lugares que mostrar. */
export const DEFAULT_CENTER = { latitude: -31.4, longitude: -64.18 };

const HIDDEN = new Set(['poi', 'transit', 'aerodrome_label']);
const AVENUES = ['motorway', 'trunk', 'primary'];

/** Recolorea un estilo del esquema OpenMapTiles por source-layer (los ids cambian entre estilos). */
export function recolor(base: StyleSpecification, isDark: boolean): StyleSpecification {
  const p = isDark ? dark : light;
  const layers = base.layers.flatMap((layer): LayerSpecification[] => {
    const src = 'source-layer' in layer ? layer['source-layer'] : undefined;
    if (src && HIDDEN.has(src)) return []; // sin comercios ni transporte: no aportan a la vigilancia
    if (layer.type === 'background')
      return [{ ...layer, paint: { ...layer.paint, 'background-color': p.land } }];
    if (layer.type === 'fill') {
      const fill =
        src === 'water'
          ? p.water
          : src === 'park' || src === 'landcover'
            ? p.park
            : src === 'building'
              ? p.building
              : p.land;
      const outline = src === 'water' ? p.bank : fill;
      return [
        { ...layer, paint: { ...layer.paint, 'fill-color': fill, 'fill-outline-color': outline } },
      ];
    }
    if (layer.type === 'line' && src === 'transportation') {
      const road: ExpressionSpecification = ['match', ['get', 'class'], AVENUES, p.avenue, p.road];
      return [{ ...layer, paint: { ...layer.paint, 'line-color': road } }];
    }
    if (layer.type === 'line' && src === 'waterway')
      return [{ ...layer, paint: { ...layer.paint, 'line-color': p.water } }];
    if (layer.type === 'symbol' && layer.layout?.['text-field'] !== undefined) {
      return [
        {
          ...layer,
          layout: {
            ...layer.layout,
            'text-field': ['coalesce', ['get', 'name:es'], ['get', 'name']],
          },
          paint: { ...layer.paint, 'text-color': p.label, 'text-halo-color': p.land },
        },
      ];
    }
    return [layer];
  });
  return { ...base, layers };
}

/** Descarga el estilo base una sola vez (VITE_MAP_STYLE_URL) y lo recolorea según el tema. */
export function useMapStyle(isDark: boolean) {
  const query = useQuery({
    queryKey: ['map-style', env.VITE_MAP_STYLE_URL],
    queryFn: async () => {
      const res = await fetch(env.VITE_MAP_STYLE_URL);
      if (!res.ok) throw new Error(`Estilo del mapa: HTTP ${String(res.status)}`);
      return (await res.json()) as StyleSpecification;
    },
    staleTime: Infinity,
    retry: 1,
  });
  const style = useMemo(
    () => (query.data ? recolor(query.data, isDark) : undefined),
    [query.data, isDark],
  );
  return { style, isError: query.isError };
}

/** Tema según la clase `.dark` del documento (la pone ThemeProvider). */
export function useDark() {
  const read = () => document.documentElement.classList.contains('dark');
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(read());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      observer.disconnect();
    };
  }, []);
  return dark;
}

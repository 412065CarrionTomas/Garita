import 'maplibre-gl/dist/maplibre-gl.css';
import type { ReactNode } from 'react';
import Map, { type MapProps } from 'react-map-gl/maplibre';
import { EmptyState } from '@/components/empty-state';
import { useDark, useMapStyle } from './map-style';

/** Mapa con el estilo del tema. Si el proveedor no responde muestra `unavailable` (o un aviso). */
export function BaseMap({ unavailable, ...props }: MapProps & { unavailable?: ReactNode }) {
  const { style, isError } = useMapStyle(useDark());
  if (isError)
    return (
      unavailable ?? (
        <EmptyState
          title="No se pudo cargar el mapa"
          description="Probá de nuevo en unos minutos."
        />
      )
    );
  if (!style)
    return (
      <p role="status" className="p-4 text-sm">
        Cargando mapa…
      </p>
    );
  // La atribución a OpenStreetMap es obligatoria (licencia ODbL): no ocultarla.
  return <Map mapStyle={style} attributionControl={{ compact: true }} {...props} />;
}

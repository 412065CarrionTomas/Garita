import 'maplibre-gl/dist/maplibre-gl.css';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { ReactNode } from 'react';
import Map, { type MapProps } from 'react-map-gl/maplibre';
import { EmptyState } from '@/components/empty-state';
import { cn } from '@/lib/utils';
import { useDark, useMapStyle, useSatellitePreference } from './map-style';

// MapLibre busca el worker junto a su propio archivo, pero Vite lo empaqueta en otra carpeta
// (.vite/deps en dev, assets/ en build): se le pasa la URL que emite Vite.
setWorkerUrl(workerUrl);

const VIEWS = [
  { label: 'Mapa', satellite: false },
  { label: 'Satélite', satellite: true },
];

function ViewToggle({
  satellite,
  onChange,
}: {
  satellite: boolean;
  onChange: (satellite: boolean) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Tipo de mapa"
      className="absolute top-3.5 left-3.5 z-10 flex overflow-hidden rounded-md border-[1.5px] border-primary bg-card"
    >
      {VIEWS.map((view) => (
        <button
          key={view.label}
          type="button"
          aria-pressed={view.satellite === satellite}
          className={cn(
            'h-9 px-3 text-[13px] font-semibold text-foreground hover:bg-muted',
            view.satellite === satellite && 'bg-primary text-primary-foreground hover:bg-primary',
          )}
          onClick={() => {
            onChange(view.satellite);
          }}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}

/** Mapa con el estilo del tema. Si el proveedor no responde muestra `unavailable` (o un aviso). */
export function BaseMap({
  unavailable,
  children,
  ...props
}: MapProps & { unavailable?: ReactNode }) {
  const [satellite, setSatellite] = useSatellitePreference();
  const { style, isError } = useMapStyle(useDark(), satellite);
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
  // La atribución a OpenStreetMap (ODbL) y a Esri en satélite es obligatoria: no ocultarla.
  return (
    <Map mapStyle={style} attributionControl={{ compact: true }} {...props}>
      <ViewToggle satellite={satellite} onChange={setSatellite} />
      {children}
    </Map>
  );
}

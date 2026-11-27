import { lazy, Suspense, useId } from 'react';

import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface Props {
  latitude: number;
  longitude: number;
  onChange: (latitude: number, longitude: number) => void;
  /** Lugares ya cargados (por ejemplo, los demás puntos del predio), de referencia y sin arrastre. */
  others?: {
    id: string;
    name: string;
    latitude: number | string;
    longitude: number | string;
    /** Rótulo chico bajo el punto (por ejemplo, su número). */
    label?: string;
  }[];
  /** false cuando el buscador va en otro lugar del formulario: el mapa queda solo. */
  search?: boolean;
  /** Alto del mapa; sin esto, una franja fija. */
  mapClassName?: string;
}

const MapLocation = lazy(() =>
  import('./site-location-map').then((module) => ({ default: module.SiteMapLocation })),
);

/** Carga manual de coordenadas: reemplaza al mapa cuando el proveedor no responde. */
export function ManualLocation({ latitude, longitude, onChange }: Props) {
  const id = useId();
  return (
    <fieldset className="min-w-0 space-y-4 rounded-xl border border-border p-4">
      <legend className="px-1 text-sm font-medium">Ubicación (carga manual)</legend>
      <Alert role="status" className="bg-info-soft text-info">
        No se pudo cargar el mapa. Ingresá las coordenadas manualmente.
      </Alert>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-latitude`}>Latitud</Label>
        <Input
          id={`${id}-latitude`}
          type="number"
          min="-90"
          max="90"
          step="any"
          required
          value={latitude}
          onChange={(event) => {
            onChange(Number(event.target.value), longitude);
          }}
          className="w-full tabular-nums"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-longitude`}>Longitud</Label>
        <Input
          id={`${id}-longitude`}
          type="number"
          min="-180"
          max="180"
          step="any"
          required
          value={longitude}
          onChange={(event) => {
            onChange(latitude, Number(event.target.value));
          }}
          className="w-full tabular-nums"
        />
      </div>
    </fieldset>
  );
}

export function SiteLocation(props: Props) {
  return (
    <Suspense fallback={<p role="status">Cargando mapa…</p>}>
      <MapLocation {...props} unavailable={<ManualLocation {...props} />} />
    </Suspense>
  );
}

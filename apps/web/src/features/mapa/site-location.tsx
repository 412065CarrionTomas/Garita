import { lazy, Suspense, useId } from 'react';
import { env } from '@/config/env';

import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  latitude: number;
  longitude: number;
  onChange: (latitude: number, longitude: number) => void;
}

const MapLocation = lazy(() =>
  import('./site-location-map').then((module) => ({ default: module.SiteMapLocation })),
);

export function SiteLocation({ latitude, longitude, onChange }: Props) {
  const id = useId();
  if (!env.VITE_GOOGLE_MAPS_API_KEY)
    return (
      <fieldset className="min-w-0 space-y-4 rounded-xl border border-border p-4">
        <legend className="px-1 text-sm font-medium">Ubicación (carga manual)</legend>
        <Alert role="status" className="bg-info-soft text-info">
          El mapa no está configurado. Ingresá las coordenadas manualmente.
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
  return (
    <Suspense fallback={<p role="status">Cargando mapa…</p>}>
      <MapLocation latitude={latitude} longitude={longitude} onChange={onChange} />
    </Suspense>
  );
}

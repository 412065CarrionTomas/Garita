import { lazy, Suspense } from 'react';
import { env } from '@/config/env';

interface Props {
  latitude: number;
  longitude: number;
  onChange: (latitude: number, longitude: number) => void;
}

const MapLocation = lazy(() =>
  import('./site-location-map').then((module) => ({ default: module.SiteMapLocation })),
);

export function SiteLocation({ latitude, longitude, onChange }: Props) {
  if (!env.VITE_GOOGLE_MAPS_API_KEY)
    return (
      <fieldset className="space-y-3 rounded border p-4">
        <legend>Ubicación (carga manual)</legend>
        <p role="status">El mapa no está configurado. Ingresá las coordenadas manualmente.</p>
        <label htmlFor="latitude">Latitud</label>
        <input
          id="latitude"
          type="number"
          min="-90"
          max="90"
          step="any"
          required
          value={latitude}
          onChange={(event) => {
            onChange(Number(event.target.value), longitude);
          }}
          className="block rounded border p-2"
        />
        <label htmlFor="longitude">Longitud</label>
        <input
          id="longitude"
          type="number"
          min="-180"
          max="180"
          step="any"
          required
          value={longitude}
          onChange={(event) => {
            onChange(latitude, Number(event.target.value));
          }}
          className="block rounded border p-2"
        />
      </fieldset>
    );
  return (
    <Suspense fallback={<p role="status">Cargando mapa…</p>}>
      <MapLocation latitude={latitude} longitude={longitude} onChange={onChange} />
    </Suspense>
  );
}

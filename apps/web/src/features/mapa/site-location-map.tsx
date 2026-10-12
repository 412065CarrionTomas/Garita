import {
  APIProvider,
  AdvancedMarker,
  Map,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { useEffect, useRef } from 'react';
import { env } from '@/config/env';

interface Props {
  latitude: number;
  longitude: number;
  onChange: (latitude: number, longitude: number) => void;
}

function InteractiveMap({ latitude, longitude, onChange }: Props) {
  const map = useMap();
  const inputRef = useRef<HTMLInputElement>(null);
  const places = useMapsLibrary('places');
  useEffect(() => {
    if (!places || !inputRef.current) return;
    const autocomplete = new places.Autocomplete(inputRef.current, {
      fields: ['geometry', 'formatted_address'],
    });
    const listener = autocomplete.addListener('place_changed', () => {
      const point = autocomplete.getPlace().geometry?.location?.toJSON();
      if (point) onChange(point.lat, point.lng);
    });
    return () => {
      listener.remove();
    };
  }, [onChange, places]);
  useEffect(() => {
    map?.panTo({ lat: latitude, lng: longitude });
  }, [latitude, longitude, map]);
  return (
    <section aria-label="Ubicación del predio" className="space-y-2">
      <label htmlFor="site-address-search">Buscar dirección (Google Places)</label>
      <input
        id="site-address-search"
        ref={inputRef}
        placeholder="Escribí una dirección"
        className="w-full rounded border p-2"
      />
      <p className="text-sm">Seleccioná la ubicación arrastrando el marcador.</p>
      <Map
        defaultCenter={{ lat: latitude, lng: longitude }}
        defaultZoom={14}
        mapId="GARITA_SITES"
        className="h-72 w-full"
      >
        <AdvancedMarker
          position={{ lat: latitude, lng: longitude }}
          draggable
          onDragEnd={(event) => {
            const point = event.latLng?.toJSON();
            if (point) onChange(point.lat, point.lng);
          }}
        />
      </Map>
    </section>
  );
}

export function SiteMapLocation(props: Props) {
  return (
    <APIProvider apiKey={env.VITE_GOOGLE_MAPS_API_KEY} libraries={['places']}>
      <InteractiveMap {...props} />
    </APIProvider>
  );
}

export function ClientSitesMap({
  sites,
}: {
  sites: { id: string; name: string; latitude: number | string; longitude: number | string }[];
}) {
  if (sites.length === 0) return <p>Este cliente no tiene predios activos.</p>;
  const firstSite = sites[0];
  if (!firstSite) return <p>Este cliente no tiene predios activos.</p>;
  const position = (site: (typeof sites)[number]) => ({
    lat: Number(site.latitude),
    lng: Number(site.longitude),
  });
  return (
    <APIProvider apiKey={env.VITE_GOOGLE_MAPS_API_KEY}>
      <Map
        defaultCenter={position(firstSite)}
        defaultZoom={10}
        mapId="GARITA_CLIENT_SITES"
        className="h-96 w-full"
      >
        {sites.map((site) => (
          <AdvancedMarker key={site.id} position={position(site)} title={site.name} />
        ))}
      </Map>
    </APIProvider>
  );
}

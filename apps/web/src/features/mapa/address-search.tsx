import { useEffect, useId, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { env } from '@/config/env';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { DEFAULT_CENTER } from './map-style';
import { parsePhoton, type AddressSuggestion } from './photon';

// bbox = Argentina. Debounce y mínimo de caracteres: uso justo del servicio público de Photon.
const BBOX = '-73.6,-55.1,-53.6,-21.8';
const MIN_CHARS = 3;
const DEBOUNCE_MS = 250;
// Sin provincias ni países: solo lo que sirve para ubicar un predio o un punto.
const LAYERS = ['house', 'street', 'other', 'locality', 'district', 'city'];

/**
 * Buscador de direcciones con Photon (patrón combobox: flechas, Enter y Escape). Con `value` y
 * `onTextChange` es además el campo de dirección del formulario: lo escrito se guarda tal cual.
 */
export function AddressSearch({
  onSelect,
  label = 'Buscar dirección',
  value,
  onTextChange,
  required,
  near,
}: {
  onSelect: (latitude: number, longitude: number, label: string) => void;
  label?: string;
  value?: string;
  onTextChange?: (text: string) => void;
  required?: boolean;
  /** Lo cercano sale primero (el predio que se edita); sin esto, o en 0, 0, la zona por defecto. */
  near?: { latitude: number; longitude: number };
}) {
  const id = useId();
  const [ownText, setOwnText] = useState('');
  const text = value ?? ownText;
  const setText = (next: string) => {
    setOwnText(next);
    onTextChange?.(next);
  };
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (open) setTerm(text.trim());
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text, open]);
  const located =
    near &&
    Number.isFinite(near.latitude) &&
    Number.isFinite(near.longitude) &&
    (near.latitude !== 0 || near.longitude !== 0);
  const center = located ? near : DEFAULT_CENTER;
  // Redondeado (~100 m): mover el marcador unos metros no invalida lo ya buscado.
  const bias = [center.latitude.toFixed(3), center.longitude.toFixed(3)] as const;
  const search = useQuery({
    queryKey: ['geocoder', env.VITE_GEOCODER_URL, term, ...bias],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        q: term,
        limit: '5',
        bbox: BBOX,
        lat: bias[0],
        lon: bias[1],
      });
      for (const layer of LAYERS) params.append('layer', layer);
      const res = await fetch(`${env.VITE_GEOCODER_URL}?${params.toString()}`, { signal });
      if (!res.ok) throw new Error(`Buscador de direcciones: HTTP ${String(res.status)}`);
      return parsePhoton(await res.json());
    },
    // Solo con la lista abierta: mover el marcador con el buscador cerrado no vuelve a buscar.
    enabled: open && term.length >= MIN_CHARS,
    // Mientras llega la nueva búsqueda quedan las anteriores: la lista no parpadea al tipear.
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  });
  const suggestions = term.length >= MIN_CHARS ? (search.data ?? []) : [];
  const expanded = open && suggestions.length > 0;
  const searching = open && search.isFetching && suggestions.length === 0;
  const choose = (suggestion: AddressSuggestion) => {
    setText(suggestion.label);
    setTerm('');
    setOpen(false);
    setActive(-1);
    onSelect(suggestion.latitude, suggestion.longitude, suggestion.label);
  };
  return (
    <div className="relative grid gap-2">
      <Label htmlFor={`${id}-input`}>{label}</Label>
      {/* Se agranda a mano como un área de texto; un texto largo no la estira solo. */}
      <Textarea
        id={`${id}-input`}
        rows={1}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={`${id}-list`}
        aria-activedescendant={
          expanded && active >= 0 ? `${id}-option-${String(active)}` : undefined
        }
        autoComplete="off"
        required={required}
        placeholder="Escribí una dirección"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onBlur={() => {
          // Sin el término, reabrir con la referencia movida no busca el texto viejo.
          setOpen(false);
          setTerm('');
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault();
          if (event.key === 'Escape') {
            setOpen(false);
            setTerm('');
            return;
          }
          if (!expanded) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive((current) =>
              current === -1 && step === -1
                ? suggestions.length - 1
                : (current + step + suggestions.length) % suggestions.length,
            );
          } else if (event.key === 'Enter') {
            const suggestion = suggestions[active];
            if (!suggestion) return;
            event.preventDefault(); // no enviar el formulario del predio
            choose(suggestion);
          }
        }}
        className="h-10 min-h-10 w-full resize-y field-sizing-fixed"
      />
      {expanded && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label="Sugerencias de direcciones"
          // Son de la búsqueda anterior mientras llega la nueva: se ven atenuadas.
          aria-busy={search.isPlaceholderData}
          className={cn(
            'absolute top-full z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-md',
            search.isPlaceholderData && 'opacity-60',
          )}
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={`${suggestion.label}-${String(index)}`}
              id={`${id}-option-${String(index)}`}
              role="option"
              aria-selected={index === active}
              // mousedown en lugar de click: se elige antes del blur que cierra la lista.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(suggestion);
              }}
              className={cn(
                'cursor-pointer px-3 py-2 text-sm text-foreground hover:bg-muted',
                index === active && 'bg-muted',
              )}
            >
              {suggestion.label}
            </li>
          ))}
        </ul>
      )}
      {searching && (
        <p
          role="status"
          className="absolute top-full z-20 mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground shadow-md"
        >
          Buscando…
        </p>
      )}
      {search.isError && (
        <p role="alert" className="text-sm text-danger">
          No se pudo buscar la dirección; ubicá el predio arrastrando el marcador.
        </p>
      )}
    </div>
  );
}

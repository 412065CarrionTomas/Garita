import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { env } from '@/config/env';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { parsePhoton, type AddressSuggestion } from './photon';

// bbox = Argentina. Debounce y mínimo de caracteres: uso justo del servicio público de Photon.
const BBOX = '-73.6,-55.1,-53.6,-21.8';
const MIN_CHARS = 3;
const DEBOUNCE_MS = 400;

/** Buscador de direcciones con Photon (patrón combobox: flechas, Enter y Escape). */
export function AddressSearch({
  onSelect,
}: {
  onSelect: (latitude: number, longitude: number) => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
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
  const search = useQuery({
    queryKey: ['geocoder', env.VITE_GEOCODER_URL, term],
    queryFn: async ({ signal }) => {
      const url = `${env.VITE_GEOCODER_URL}?q=${encodeURIComponent(term)}&limit=5&bbox=${BBOX}`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Buscador de direcciones: HTTP ${String(res.status)}`);
      return parsePhoton(await res.json());
    },
    enabled: term.length >= MIN_CHARS,
    staleTime: Infinity,
    retry: false,
  });
  const suggestions = search.data ?? [];
  const expanded = open && suggestions.length > 0;
  const choose = (suggestion: AddressSuggestion) => {
    setText(suggestion.label);
    setTerm('');
    setOpen(false);
    setActive(-1);
    onSelect(suggestion.latitude, suggestion.longitude);
  };
  return (
    <div className="relative grid gap-2">
      <Label htmlFor={`${id}-input`}>Buscar dirección</Label>
      <Input
        id={`${id}-input`}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={`${id}-list`}
        aria-activedescendant={
          expanded && active >= 0 ? `${id}-option-${String(active)}` : undefined
        }
        autoComplete="off"
        placeholder="Escribí una dirección"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onBlur={() => {
          setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault();
          if (event.key === 'Escape') {
            setOpen(false);
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
        className="w-full"
      />
      {expanded && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label="Sugerencias de direcciones"
          className="absolute top-full z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-md"
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
      {search.isError && (
        <p role="alert" className="text-sm text-danger">
          No se pudo buscar la dirección; ubicá el predio arrastrando el marcador.
        </p>
      )}
    </div>
  );
}

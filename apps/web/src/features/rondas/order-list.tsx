import type { RouteInput } from '@garita/shared';
import { ChevronDown, ChevronUp, GripVertical, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatMeters, type PartInfo } from './route-draft';

/** Pestaña Orden: los puntos de la ronda en orden (se arrastran o se suben y bajan) y los de afuera. */
export function OrderList({
  selected,
  outside,
  visible,
  nameOf,
  route,
  meters,
  parts,
  stale,
  sharedIds,
  focusId,
  onFocus,
  onMove,
  onRemove,
  onAdd,
}: {
  selected: string[];
  /** Puntos del predio que no están en la ronda (ya filtrados por la búsqueda). */
  outside: { id: string; name: string }[];
  /** Si el punto coincide con la búsqueda. */
  visible: (id: string) => boolean;
  nameOf: (id: string) => string;
  route: RouteInput;
  meters: number[];
  parts: PartInfo[];
  stale: ReadonlySet<number>;
  sharedIds: ReadonlySet<string>;
  focusId: string | null;
  onFocus: (id: string) => void;
  onMove: (id: string, index: number) => void;
  onRemove: (id: string) => void;
  onAdd: (id: string) => void;
}) {
  return (
    <>
      {selected.length === 0 && (
        <p className="p-3 text-sm text-muted-foreground">
          Sumá puntos desde la lista de abajo o con «Sumar puntos de control» en el mapa.
        </p>
      )}
      <ol aria-label="Orden de puntos">
        {selected.map((id, index) => {
          if (!visible(id)) return null;
          const leg = route.legs[index];
          const label = nameOf(id);
          const legParts = parts.filter((p) => p.l === index);
          const isFocus = focusId === id;
          return (
            <li
              key={id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', id);
              }}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                // Sin esto, Firefox intenta abrir el texto soltado.
                event.preventDefault();
                onMove(event.dataTransfer.getData('text/plain'), index);
              }}
              className={cn(
                'group flex min-h-11 items-center gap-1.5 border-b border-border pr-1 pl-2',
                isFocus && 'bg-muted',
              )}
            >
              <GripVertical
                aria-hidden="true"
                className="size-4 shrink-0 cursor-grab text-muted-foreground"
              />
              <span className="t-numeral w-7 shrink-0 text-right">{index + 1}</span>
              <button
                type="button"
                className="min-w-0 flex-1 py-1 text-left"
                onClick={() => {
                  onFocus(id);
                }}
              >
                <span className="block truncate font-medium">{label}</span>
                <span className="block text-xs text-muted-foreground tabular-nums">
                  {leg
                    ? `→ ${formatMeters(meters[index] ?? 0)}${leg.sections.length > 1 ? ` · ${String(leg.sections.length)} partes` : ''}`
                    : 'Fin del recorrido'}
                  {legParts.some((p) => p.state === 'failed') && ' · ✕ falló'}
                  {legParts.some((p) => p.state === 'pending') && ' · sin calcular'}
                  {stale.has(index) && ' · se movió un punto'}
                  {sharedIds.has(id) && ' · compartido'}
                </span>
              </button>
              <span className="flex opacity-60 group-focus-within:opacity-100 group-hover:opacity-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Subir ${label}`}
                  disabled={index === 0}
                  onClick={() => {
                    onMove(id, index - 1);
                  }}
                >
                  <ChevronUp aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Bajar ${label}`}
                  disabled={index === selected.length - 1}
                  onClick={() => {
                    onMove(id, index + 1);
                  }}
                >
                  <ChevronDown aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Quitar ${label}`}
                  onClick={() => {
                    onRemove(id);
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              </span>
            </li>
          );
        })}
      </ol>
      {outside.length > 0 && (
        <>
          <h4 className="t-label px-3 pt-4 pb-1">Fuera de la ronda</h4>
          <ul aria-label="Puntos fuera de la ronda">
            {outside.map((point) => (
              <li
                key={point.id}
                className="flex min-h-10 items-center gap-2 border-b border-border pr-1 pl-3"
              >
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{point.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Sumar ${point.name}`}
                  onClick={() => {
                    onAdd(point.id);
                  }}
                >
                  <Plus aria-hidden="true" />
                  Sumar
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

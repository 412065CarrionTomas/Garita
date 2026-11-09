import { useEffect, useMemo, useRef, useState } from 'react';

import type { PointStatus } from '@/components/point-path';
import { SegmentedFilter } from '@/components/segmented-filter';
import { Stamp, type StampVariant } from '@/components/stamp';
import { cn } from '@/lib/utils';

export interface PointTableRow {
  id: string;
  label: string;
  /** Hora prevista, ya formateada (ej. "08:15"). */
  scheduledAt: string;
  /** Hora registrada, ya formateada; null si todavía no hay registro. */
  registeredAt?: string | null;
  /** Registro fuera de ventana: el sello pasa a ámbar. */
  late?: boolean;
  status: PointStatus;
}

type Filter = 'all' | 'pending' | 'missed';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'missed', label: 'Sin registro' },
];

const STATUS_STAMP: Record<PointStatus, StampVariant> = {
  done: 'normal',
  next: 'now',
  missed: 'fail',
  pending: 'dashed',
};

const STATUS_LABEL: Record<PointStatus, string> = {
  done: 'Registrado',
  next: 'Próximo',
  missed: 'Sin registro',
  pending: 'Pendiente',
};

const matches: Record<Filter, (r: PointTableRow) => boolean> = {
  all: () => true,
  pending: (r) => r.status === 'pending' || r.status === 'next',
  missed: (r) => r.status === 'missed',
};

/** Filas que se muestran antes del punto actual al abrir la tabla. */
const LEAD_ROWS = 2;

/**
 * Tabla de puntos de una ronda con encabezado fijo. Arranca centrada en el punto actual (el
 * próximo), dos filas antes, y vuelve a centrarse cuando cambia la fila seleccionada.
 */
export function PointTable({
  rows,
  selectedId,
  onSelect,
  className,
}: {
  rows: PointTableRow[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const shown = useMemo(() => rows.filter(matches[filter]), [rows, filter]);
  const scroller = useRef<HTMLDivElement>(null);
  const currentId = rows.find((r) => r.status === 'next')?.id;

  const centerOn = (id: string | null | undefined, smooth: boolean) => {
    const box = scroller.current;
    const idx = shown.findIndex((r) => r.id === id);
    if (!box || idx < 0) return;
    const rowEls = box.querySelectorAll<HTMLElement>('tbody tr[data-row]');
    const head = box.querySelector<HTMLElement>('thead');
    const first = rowEls[Math.max(idx - LEAD_ROWS, 0)];
    if (!first) return;
    // jsdom no implementa scrollTo
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    box.scrollTo?.({
      top: Math.max(first.offsetTop - (head?.offsetHeight ?? 0), 0),
      behavior: smooth ? 'smooth' : 'auto',
    });
  };

  // Al abrir (o al cambiar de ronda/filtro) se centra el punto actual; al elegir otro, ese.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    centerOn(currentId, false);
  }, [currentId, filter]);
  useEffect(() => {
    centerOn(selectedId, true);
  }, [selectedId]);
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <div data-slot="point-table" className={cn('flex min-h-0 flex-col gap-3', className)}>
      <SegmentedFilter
        ariaLabel="Filtrar puntos"
        options={FILTERS}
        value={filter}
        onChange={setFilter}
      />
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto border-y border-input">
        <table className="w-full border-collapse text-left">
          <thead className="t-label sticky top-0 z-10 bg-muted text-muted-foreground">
            <tr className="h-9 border-b border-input">
              <th scope="col" className="w-12 px-3 font-semibold">
                N°
              </th>
              <th scope="col" className="px-3 font-semibold">
                Punto
              </th>
              <th scope="col" className="px-3 font-semibold">
                Prevista
              </th>
              <th scope="col" className="px-3 font-semibold">
                Registrada
              </th>
              <th scope="col" className="px-3 font-semibold">
                Estado
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const selected = r.id === selectedId;
              const n = rows.indexOf(r) + 1;
              return (
                <tr
                  key={r.id}
                  data-row
                  className={cn(
                    'min-h-14 border-b border-border hover:bg-muted',
                    selected && 'bg-muted outline outline-2 -outline-offset-2 outline-foreground',
                  )}
                >
                  <td className="t-numeral px-3 py-2 text-muted-foreground">{n}</td>
                  <td className="px-3 py-2 font-semibold">
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onSelect?.(r.id)}
                      className="text-left hover:underline"
                    >
                      {r.label}
                    </button>
                  </td>
                  <td className="t-numeral px-3 py-2 text-muted-foreground">{r.scheduledAt}</td>
                  <td className="px-3 py-2">
                    {r.registeredAt ? (
                      <Stamp variant={r.late ? 'late' : 'normal'} check>
                        {r.registeredAt}
                      </Stamp>
                    ) : (
                      <span aria-label="Sin hora registrada" className="text-muted-foreground">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Stamp variant={STATUS_STAMP[r.status]}>{STATUS_LABEL[r.status]}</Stamp>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            No hay puntos con este filtro. Probá con “Todos”.
          </p>
        )}
      </div>
    </div>
  );
}

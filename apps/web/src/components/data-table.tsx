import { useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { compareValues, isEmpty, type DataColumnType, type SortValue } from '@/lib/compare-values';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface DataColumn<T> {
  id: string;
  header: string;
  /** Define cómo se ordena la columna. Por defecto, texto. */
  type?: DataColumnType;
  /** Valor para ordenar (y para mostrar si no hay `cell`). Sin él, la columna no se ordena. */
  value?: (row: T) => SortValue;
  cell?: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /** Ancho inicial en px; sin él, la columna toma el espacio que sobra. */
  width?: number;
  /** Botones junto al título (fuera del botón de ordenar), ej. "Agregar" en la columna principal. */
  headerActions?: ReactNode;
  /** Encabezado solo para lectores de pantalla (ej. la columna de acciones). */
  hideHeader?: boolean;
  className?: string;
}

type Sort = { id: string; dir: 'asc' | 'desc' } | null;

const MIN_WIDTH = 48;
const KEY_STEP = 16;

/**
 * Pone el texto completo como `title` solo donde está cortado con "…": la celda o sus renglones
 * `truncate` (ej. nombre y dirección de un punto).
 */
function revealIfTruncated(event: { currentTarget: HTMLElement }) {
  const cell = event.currentTarget;
  for (const el of [cell, ...cell.querySelectorAll<HTMLElement>('.truncate')]) {
    if (el.scrollWidth > el.clientWidth) el.title = el.textContent;
    else el.removeAttribute('title');
  }
}

/**
 * Tabla con columnas que se reordenan (arrastrando el encabezado o con Alt+←/→), se ensanchan o
 * angostan (borde derecho del encabezado, con mouse o flechas) y se ordenan por su tipo de dato al
 * hacer clic. El texto que no entra se corta con "…" y se ve completo al pasar el mouse. Nada de
 * esto se guarda: vive mientras la tabla está en pantalla.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  label,
  className,
  rowClassName,
}: {
  columns: DataColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  label: string;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
}) {
  const [order, setOrder] = useState(() => columns.map((column) => column.id));
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(columns.flatMap((c) => (c.width ? [[c.id, c.width]] : []))),
  );
  const [sort, setSort] = useState<Sort>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const resizing = useRef<{ id: string; x: number; width: number } | null>(null);
  const headRefs = useRef<Record<string, HTMLTableCellElement | null>>({});

  // Columnas nuevas (o que dejaron de venir) se ajustan sin perder el orden elegido.
  const byId = new Map(columns.map((column) => [column.id, column]));
  const visible = [
    ...order.filter((id) => byId.has(id)),
    ...columns.map((c) => c.id).filter((id) => !order.includes(id)),
  ].flatMap((id) => byId.get(id) ?? []);

  const sorted = (() => {
    const column = sort && byId.get(sort.id);
    if (!sort || !column?.value) return rows;
    const read = column.value;
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const [x, y] = [read(a), read(b)];
      // Los vacíos quedan al final en los dos sentidos.
      if (isEmpty(x) || isEmpty(y)) return compareValues(x, y, column.type);
      return sign * compareValues(x, y, column.type);
    });
  })();

  const move = (id: string, to: number) => {
    const ids = visible.map((c) => c.id).filter((other) => other !== id);
    const target = Math.max(0, Math.min(ids.length, to));
    ids.splice(target, 0, id);
    setOrder(ids);
    setAnnouncement(`${byId.get(id)?.header ?? ''}: columna ${target + 1} de ${ids.length}`);
  };
  const toggleSort = (column: DataColumn<T>) => {
    if (!column.value) return;
    setSort((current) =>
      current?.id !== column.id
        ? { id: column.id, dir: 'asc' }
        : current.dir === 'asc'
          ? { id: column.id, dir: 'desc' }
          : null,
    );
  };
  const widthOf = (id: string) =>
    widths[id] ?? Math.max(MIN_WIDTH, headRefs.current[id]?.getBoundingClientRect().width ?? 0);
  const resize = (id: string, width: number) => {
    setWidths((current) => ({ ...current, [id]: Math.max(MIN_WIDTH, Math.round(width)) }));
  };

  return (
    <>
      <Table
        aria-label={label}
        containerClassName="overflow-visible"
        className={cn('table-fixed', className)}
      >
        <colgroup>
          {visible.map((column) => (
            <col
              key={column.id}
              style={widths[column.id] ? { width: widths[column.id] } : undefined}
            />
          ))}
        </colgroup>
        <TableHeader className="sticky top-0 z-10">
          <TableRow>
            {visible.map((column, index) => {
              const sortDir = sort?.id === column.id ? sort.dir : null;
              return (
                <TableHead
                  key={column.id}
                  aria-label={column.header}
                  ref={(el) => {
                    headRefs.current[column.id] = el;
                  }}
                  aria-sort={
                    sortDir === 'asc' ? 'ascending' : sortDir === 'desc' ? 'descending' : undefined
                  }
                  draggable
                  onDragStart={(event) => {
                    if (resizing.current) {
                      event.preventDefault();
                      return;
                    }
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', column.id);
                    setDragged(column.id);
                  }}
                  onDragOver={(event) => {
                    if (dragged && dragged !== column.id) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragged) move(dragged, index);
                    setDragged(null);
                  }}
                  onDragEnd={() => {
                    setDragged(null);
                  }}
                  className={cn(
                    'relative overflow-hidden px-3 select-none',
                    column.align === 'right' && 'text-right',
                    dragged === column.id && 'opacity-50',
                    dragged && dragged !== column.id && 'cursor-copy',
                  )}
                >
                  {column.hideHeader ? (
                    <span className="sr-only">{column.header}</span>
                  ) : (
                    <button
                      type="button"
                      title={`${column.header}. Clic para ordenar; arrastrá o usá Alt+←/→ para moverla.`}
                      onClick={() => {
                        toggleSort(column);
                      }}
                      onKeyDown={(event) => {
                        if (!event.altKey) return;
                        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                        event.preventDefault();
                        move(column.id, index + (event.key === 'ArrowLeft' ? -1 : 1));
                      }}
                      className={cn(
                        't-label inline-flex max-w-full cursor-grab items-center gap-1 uppercase',
                        column.align === 'right' && 'flex-row-reverse',
                        sortDir && 'text-foreground',
                      )}
                    >
                      <span className="truncate">{column.header}</span>
                      <span aria-hidden="true" className="w-2 shrink-0">
                        {sortDir === 'asc' ? '▲' : sortDir === 'desc' ? '▼' : ''}
                      </span>
                    </button>
                  )}
                  {column.headerActions && (
                    <span className="ml-1.5 inline-flex items-center gap-1.5 align-middle">
                      {column.headerActions}
                    </span>
                  )}
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Ancho de ${column.header}`}
                    aria-valuemin={MIN_WIDTH}
                    aria-valuenow={widths[column.id]}
                    tabIndex={0}
                    className="group absolute inset-y-0 right-0 flex w-2 cursor-col-resize touch-none justify-center"
                    onPointerDown={(event) => {
                      if (event.pointerType === 'mouse' && event.button !== 0) return;
                      event.preventDefault();
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      resizing.current = {
                        id: column.id,
                        x: event.clientX,
                        width: widthOf(column.id),
                      };
                    }}
                    onPointerMove={(event) => {
                      const start = resizing.current;
                      if (start?.id !== column.id) return;
                      resize(column.id, start.width + event.clientX - start.x);
                    }}
                    onLostPointerCapture={() => {
                      resizing.current = null;
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                      event.preventDefault();
                      const step = event.key === 'ArrowLeft' ? -KEY_STEP : KEY_STEP;
                      resize(column.id, widthOf(column.id) + step);
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="w-px bg-border group-hover:w-0.5 group-hover:bg-primary group-focus-visible:w-0.5 group-focus-visible:bg-primary"
                    />
                  </span>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => (
            <TableRow key={getRowId(row)} className={rowClassName?.(row)}>
              {visible.map((column) => (
                <TableCell
                  key={column.id}
                  onMouseEnter={revealIfTruncated}
                  className={cn(
                    'h-10 truncate px-3',
                    column.align === 'right' && 'text-right',
                    column.className,
                  )}
                >
                  {column.cell ? column.cell(row) : formatValue(column.value?.(row))}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}

function formatValue(value: SortValue): ReactNode {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toLocaleDateString('es-AR');
  if (typeof value === 'number') return value.toLocaleString('es-AR');
  return value;
}

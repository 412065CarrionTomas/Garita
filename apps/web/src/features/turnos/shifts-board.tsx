import type { ShiftBoard, ShiftBoardCell } from '@garita/shared';
import { Plus, Repeat } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ORIGIN_LABELS,
  PROBLEM_STATUSES,
  SHIFT_STATES,
  calendarDate,
  formatShiftTime,
  gapAction,
  isCancelled,
  isFinished,
} from './shift-utils';

/**
 * Planilla semanal: predios en filas, lunes a domingo en columnas. Los turnos van como texto; solo
 * los huecos llevan marca y, si todavía se puede, la acción para resolverlos.
 */
export function ShiftsBoard({
  board,
  now,
  filter,
  onOpen,
  onAction,
  onAdd,
}: {
  board: ShiftBoard;
  now: number;
  /** Si viene, solo se muestran los turnos que cumplen (y los predios que tengan alguno). */
  filter?: (cell: ShiftBoardCell) => boolean;
  onOpen: (cell: ShiftBoardCell) => void;
  onAction: (cell: ShiftBoardCell, action: 'assign' | 'cover') => void;
  onAdd: (siteId: string, date: string) => void;
}) {
  const visible = (cell: ShiftBoardCell) => !filter || filter(cell);
  const sites = filter
    ? board.sites.filter((site) => site.days.some((day) => day.some(visible)))
    : board.sites;
  if (filter && sites.length === 0)
    return (
      <EmptyState
        title="Nada para mostrar esta semana"
        description="Ningún turno coincide con el filtro. Tocá de nuevo la cifra o cambiá el estado."
      />
    );
  return (
    <div className="overflow-x-auto border-[1.5px] border-input">
      <table
        className="w-full min-w-[960px] table-fixed border-collapse"
        aria-label="Planilla semanal"
      >
        <colgroup>
          <col className="w-48" />
          {board.days.map((day) => (
            <col key={day} />
          ))}
        </colgroup>
        <thead className="bg-muted">
          <tr className="border-b border-border">
            <th scope="col" className="px-3 py-2 text-left text-sm font-semibold">
              Predio
            </th>
            {board.days.map((day) => {
              const today = day === board.today;
              return (
                <th
                  key={day}
                  scope="col"
                  aria-current={today ? 'date' : undefined}
                  className={cn(
                    'border-l border-border px-3 py-2 text-left text-sm',
                    today ? 'bg-primary font-bold text-primary-foreground' : 'font-semibold',
                    day < board.today && 'text-muted-foreground',
                  )}
                >
                  <span className="capitalize">
                    {calendarDate(day, { weekday: 'short', day: 'numeric' })}
                  </span>
                  {today && <span className="sr-only"> (hoy)</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sites.map((site) => (
            <tr key={site.id} className="border-b border-border align-top last:border-b-0">
              <th scope="row" className="bg-muted/60 px-3 py-2 text-left text-base font-semibold">
                {site.name}
              </th>
              {site.days.map((cells, index) => {
                const day = board.days[index] ?? '';
                const shown = cells.filter(visible);
                return (
                  <td
                    key={day}
                    className={cn(
                      'group border-l border-border p-1.5',
                      day === board.today && 'bg-primary/5',
                      day < board.today && 'text-muted-foreground',
                    )}
                  >
                    <ul className="space-y-1.5">
                      {shown.map((cell) => (
                        <li key={cell.id}>
                          <BoardShift
                            cell={cell}
                            timezone={board.timezone}
                            now={now}
                            onOpen={onOpen}
                            onAction={onAction}
                          />
                        </li>
                      ))}
                    </ul>
                    {day >= board.today && !filter && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                        aria-label={`Agregar turno en ${site.name} el ${calendarDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}`}
                        onClick={() => {
                          onAdd(site.id, day);
                        }}
                      >
                        <Plus aria-hidden="true" className="size-4" />
                        Agregar
                      </Button>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoardShift({
  cell,
  timezone,
  now,
  onOpen,
  onAction,
}: {
  cell: ShiftBoardCell;
  timezone: string;
  now: number;
  onOpen: (cell: ShiftBoardCell) => void;
  onAction: (cell: ShiftBoardCell, action: 'assign' | 'cover') => void;
}) {
  const problem = PROBLEM_STATUSES.has(cell.status);
  const cancelled = isCancelled(cell.status);
  const action = gapAction(cell, now);
  const live = cell.status === 'in_progress';
  const time = `${formatShiftTime(cell.startsAt, timezone)}–${formatShiftTime(cell.endsAt, timezone)}`;
  const past = Date.parse(cell.endsAt) < now;
  // El fondo dice en qué está el turno: lo que viene es tarjeta, lo que pasó se apaga, y solo el
  // hueco que todavía se puede resolver se marca fuerte; el hueco pasado queda como dato.
  const surface = action
    ? 'border-l-4 border-warning bg-warning-soft'
    : live
      ? 'border-l-4 border-success bg-success-soft'
      : cancelled
        ? ''
        : problem
          ? 'border border-dashed border-input'
          : past || isFinished(cell.status)
            ? 'bg-muted'
            : 'border border-border bg-card';
  return (
    <div className={cn('rounded-sm', surface)}>
      <button
        type="button"
        className="block w-full rounded-sm px-2 py-1 text-left hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-ring"
        title={cell.rounds.join(', ')}
        onClick={() => {
          onOpen(cell);
        }}
      >
        <span
          className={cn(
            'block truncate text-sm font-semibold',
            cancelled && 'line-through',
            !cell.guard && 'italic',
          )}
        >
          {cell.guard?.name ?? 'Sin vigilador'}
        </span>
        <span className="flex items-center gap-1 text-sm tabular-nums">
          {time}
          {cell.origin !== 'manual' && (
            <Repeat
              className={cn('size-3.5 shrink-0', cell.origin === 'modified' && 'text-warning')}
              role="img"
              aria-label={ORIGIN_LABELS[cell.origin]}
            />
          )}
        </span>
        {(problem || live || cancelled) && (
          <span
            className={cn(
              'block text-sm font-semibold',
              action
                ? 'text-warning'
                : live
                  ? 'text-success'
                  : problem
                    ? 'text-danger'
                    : 'text-muted-foreground',
            )}
          >
            {SHIFT_STATES[cell.status]?.label}
          </span>
        )}
      </button>
      {action && (
        <div className="px-2 pb-1.5">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => {
              onAction(cell, action);
            }}
          >
            {action === 'assign' ? 'Asignar' : 'Cubrir'}
          </Button>
        </div>
      )}
    </div>
  );
}

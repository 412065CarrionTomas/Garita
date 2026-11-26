import type { ShiftBoard, ShiftBoardCell } from '@garita/shared';
import { Plus, Repeat } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ORIGIN_LABELS,
  PROBLEM_STATUSES,
  SHIFT_STATES,
  calendarDate,
  formatShiftTime,
  isCancelled,
} from './shift-utils';

/**
 * Planilla semanal: predios en filas, lunes a domingo en columnas. Cada turno muestra quién lo
 * cubre y en qué horario; los huecos (sin vigilador, no presentado, sin cobertura) se marcan con
 * borde, fondo y texto, y ofrecen cubrirlos ahí mismo.
 */
export function ShiftsBoard({
  board,
  statuses,
  onOpen,
  onCover,
  onAdd,
}: {
  board: ShiftBoard;
  /** Si viene, solo se muestran los turnos en estos estados (y los predios que tengan alguno). */
  statuses?: readonly string[];
  onOpen: (cell: ShiftBoardCell) => void;
  onCover: (cell: ShiftBoardCell) => void;
  onAdd: (siteId: string, date: string) => void;
}) {
  const visible = (cell: ShiftBoardCell) => !statuses || statuses.includes(cell.status);
  const sites = statuses
    ? board.sites.filter((site) => site.days.some((day) => day.some(visible)))
    : board.sites;
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
        <thead>
          <tr className="border-b-[1.5px] border-input bg-muted">
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
                    'border-l border-input px-2 py-2 text-left',
                    today && 'bg-primary text-primary-foreground',
                  )}
                >
                  <span className="block text-sm font-semibold capitalize">
                    {calendarDate(day, { weekday: 'long' })}
                  </span>
                  <span className="t-numeral block text-lg leading-tight">
                    {calendarDate(day, { day: 'numeric', month: 'short' })}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sites.map((site) => (
            <tr key={site.id} className="border-b border-input align-top last:border-b-0">
              <th scope="row" className="px-3 py-2 text-left text-base font-semibold">
                {site.name}
              </th>
              {site.days.map((cells, index) => {
                const day = board.days[index] ?? '';
                const shown = cells.filter(visible);
                return (
                  <td
                    key={day}
                    className={cn(
                      'group border-l border-input p-1.5',
                      day === board.today && 'bg-primary/5',
                    )}
                  >
                    <ul className="space-y-1.5">
                      {shown.map((cell) => (
                        <li key={cell.id}>
                          <BoardShift
                            cell={cell}
                            timezone={board.timezone}
                            onOpen={onOpen}
                            onCover={onCover}
                          />
                        </li>
                      ))}
                    </ul>
                    {day >= board.today && !statuses && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={cn(
                          'mt-1 w-full justify-center text-muted-foreground',
                          shown.length > 0 &&
                            'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                        )}
                        aria-label={`Agregar turno en ${site.name} el ${calendarDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}`}
                        onClick={() => {
                          onAdd(site.id, day);
                        }}
                      >
                        <Plus aria-hidden="true" className="size-4" />
                        {shown.length === 0 && 'Agregar'}
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
  onOpen,
  onCover,
}: {
  cell: ShiftBoardCell;
  timezone: string;
  onOpen: (cell: ShiftBoardCell) => void;
  onCover: (cell: ShiftBoardCell) => void;
}) {
  const problem = PROBLEM_STATUSES.has(cell.status);
  const cancelled = isCancelled(cell.status);
  const state = SHIFT_STATES[cell.status];
  const time = `${formatShiftTime(cell.startsAt, timezone)}–${formatShiftTime(cell.endsAt, timezone)}`;
  return (
    <div
      className={cn(
        'rounded-sm border-[1.5px] border-input bg-background',
        problem && 'border-warning bg-warning-soft',
        cancelled && 'border-dashed text-muted-foreground',
      )}
    >
      <button
        type="button"
        className="block w-full px-2 py-1.5 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
        title={cell.rounds.join(', ')}
        onClick={() => {
          onOpen(cell);
        }}
      >
        <span className={cn('block truncate text-sm font-semibold', cancelled && 'line-through')}>
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
      </button>
      {(cell.status !== 'scheduled' || problem) && (
        <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5">
          {state && <StatusBadge tone={state.tone}>{state.label}</StatusBadge>}
          {problem && (
            <Button
              type="button"
              size="sm"
              className="ml-auto h-7 px-2"
              onClick={() => {
                onCover(cell);
              }}
            >
              Cubrir
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

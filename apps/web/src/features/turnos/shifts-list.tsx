import { EllipsisVertical, Repeat } from 'lucide-react';
import { Link } from 'react-router';
import { DataTable, type DataSort } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  ORIGIN_LABELS,
  PROBLEM_STATUSES,
  SHIFT_STATES,
  calendarDate,
  formatShiftTime,
  guardName,
  gapAction,
  isCancelled,
  isEditable,
  shiftOrigin,
  type ShiftRow,
} from './shift-utils';

export function ShiftsList({
  rows,
  now,
  sort,
  onSortChange,
  onEdit,
  onCover,
  onCancel,
}: {
  rows: ShiftRow[];
  now: number;
  sort: DataSort;
  onSortChange: (sort: DataSort) => void;
  onEdit: (shift: ShiftRow) => void;
  onCover: (shift: ShiftRow) => void;
  onCancel: (shift: ShiftRow) => void;
}) {
  return (
    <div className="overflow-x-auto border-[1.5px] border-input">
      <DataTable<ShiftRow>
        label="Turnos"
        rows={rows}
        getRowId={(row) => row.id}
        sort={sort}
        onSortChange={onSortChange}
        rowClassName={(row) =>
          PROBLEM_STATUSES.has(row.status)
            ? 'bg-warning-soft'
            : isCancelled(row.status)
              ? 'text-muted-foreground'
              : undefined
        }
        columns={[
          {
            id: 'date',
            header: 'Fecha',
            width: 150,
            value: (row) => row.startsAt,
            cell: (row) => (
              <span className="font-semibold capitalize tabular-nums">
                {calendarDate(row.serviceDate.slice(0, 10), {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
              </span>
            ),
          },
          {
            id: 'site',
            header: 'Predio',
            width: 230,
            value: (row) => row.site.name,
            cell: (row) => (
              <span className={cn('font-semibold', isCancelled(row.status) && 'line-through')}>
                {row.site.name}
              </span>
            ),
          },
          {
            id: 'guard',
            header: 'Vigilador',
            width: 200,
            cell: (row) => {
              const guard = row.assignments[0]?.guard;
              return guard ? (
                <span>
                  {guardName(guard)}
                  {guard.status === 'invitation_pending' && (
                    <span className="text-muted-foreground"> · invitación pendiente</span>
                  )}
                </span>
              ) : (
                <span className="font-semibold text-warning">Sin vigilador</span>
              );
            },
          },
          {
            id: 'time',
            header: 'Horario',
            width: 140,
            cell: (row) => {
              const timezone = row.site.company.timezone;
              return (
                <span className="t-numeral">
                  {formatShiftTime(row.startsAt, timezone)}–{formatShiftTime(row.endsAt, timezone)}
                </span>
              );
            },
          },
          {
            id: 'rounds',
            header: 'Rondas',
            cell: (row) => (
              <span className="block truncate">
                {row.rounds.map(({ round }) => round.name).join(', ')}
              </span>
            ),
          },
          {
            id: 'status',
            header: 'Estado',
            width: 220,
            cell: (row) => {
              const state = SHIFT_STATES[row.status];
              const origin = shiftOrigin(row);
              return (
                <span className="flex items-center gap-2">
                  <StatusBadge tone={state?.tone ?? 'neutral'}>
                    {state?.label ?? 'Estado desconocido'}
                  </StatusBadge>
                  {origin !== 'manual' && (
                    <span title={ORIGIN_LABELS[origin]}>
                      <Repeat
                        role="img"
                        aria-label={ORIGIN_LABELS[origin]}
                        className={cn('size-4 shrink-0', origin === 'modified' && 'text-warning')}
                      />
                    </span>
                  )}
                </span>
              );
            },
          },
          {
            id: 'actions',
            header: 'Acciones',
            hideHeader: true,
            width: 64,
            align: 'right',
            cell: (row) => (
              <ShiftActions
                shift={row}
                now={now}
                onEdit={onEdit}
                onCover={onCover}
                onCancel={onCancel}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

function ShiftActions({
  shift,
  now,
  onEdit,
  onCover,
  onCancel,
}: {
  shift: ShiftRow;
  now: number;
  onEdit: (shift: ShiftRow) => void;
  onCover: (shift: ShiftRow) => void;
  onCancel: (shift: ShiftRow) => void;
}) {
  const editable = isEditable(shift, now);
  // Reasignar solo lo que la API acepta: en hora, sin vigilador o sin cobertura.
  const coverable = gapAction(shift, now) === 'cover';
  // Programado y en hora, pero el vigilador no inició: la API acepta pasarlo a otro.
  const reassignable =
    shift.status === 'scheduled' &&
    Date.parse(shift.startsAt) <= now &&
    Date.parse(shift.endsAt) > now;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Acciones del turno de ${shift.site.name}`}
        >
          <EllipsisVertical aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        {editable && (
          <DropdownMenuItem
            onSelect={() => {
              onEdit(shift);
            }}
          >
            {shift.assignments[0]?.guard ? 'Editar' : 'Asignar vigilador'}
          </DropdownMenuItem>
        )}
        {(coverable || reassignable) && (
          <DropdownMenuItem
            onSelect={() => {
              onCover(shift);
            }}
          >
            {coverable ? 'Cubrir' : 'Reasignar'}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to={`/supervision/turnos/${shift.id}`}>Ver detalle</Link>
        </DropdownMenuItem>
        {editable && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                onCancel(shift);
              }}
            >
              Cancelar turno
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

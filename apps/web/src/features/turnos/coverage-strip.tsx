import type { ShiftBoard } from '@garita/shared';
import { Kpi } from '@/components/kpi';
import { cn } from '@/lib/utils';
import type { BoardFocus } from './shift-utils';

/**
 * Cifras de cobertura de la semana, con el mismo formato que Cumplimiento. Las que piden una
 * acción filtran la planilla al tocarlas; volver a tocarlas quita el filtro.
 */
export function CoverageStrip({
  summary,
  focus,
  onFocus,
}: {
  summary: ShiftBoard['summary'];
  focus: BoardFocus | null;
  onFocus: (focus: BoardFocus) => void;
}) {
  // Misma estructura que <Kpi />, con el número como botón que ocupa toda la casilla.
  const tile = (key: BoardFocus, label: string, value: number, detail: string, tone: string) => (
    <div
      className={cn(
        'relative flex flex-col gap-1 bg-card px-4 py-3 hover:bg-muted',
        focus === key && 'bg-muted ring-2 ring-primary ring-inset',
      )}
    >
      <dt className="t-label text-muted-foreground">{label}</dt>
      <dd>
        <button
          type="button"
          aria-pressed={focus === key}
          aria-label={`${label}: ${String(value)}. ${focus === key ? 'Quitar filtro' : 'Mostrar solo estos'}`}
          className={cn(
            't-numeral text-3xl leading-none after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring',
            value > 0 && tone,
          )}
          onClick={() => {
            onFocus(key);
          }}
        >
          {value}
        </button>
      </dd>
      <dd className="text-sm text-muted-foreground">{detail}</dd>
    </div>
  );
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <dl className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Turnos de la semana"
          value={summary.total}
          detail={`En ${String(summary.sites)} ${summary.sites === 1 ? 'predio' : 'predios'}`}
        />
        {tile(
          'asignar',
          'Para asignar',
          summary.toAssign,
          'Próximos sin vigilador',
          'text-warning',
        )}
        {tile('cubrir', 'Para cubrir ahora', summary.toCover, 'En hora y sin nadie', 'text-danger')}
        {tile('ausencias', 'No presentados', summary.noShows, 'En la semana, como dato', '')}
      </dl>
    </div>
  );
}

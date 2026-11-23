import { adminSummaryCatalog, type SiteDayGrid, type SiteDayStatus } from '@garita/shared';
import { Stamp } from '@/components/stamp';
import { cn } from '@/lib/utils';
import { useSiteDayGrid } from '../queries';
import { WidgetEmpty, WidgetFrame, WidgetStatus } from '../widget-frame';
import type { WidgetProps } from './widget-props';

type Cell = SiteDayGrid['sites'][number]['cells'][number];

/** Texto de cada estado: el casillero también lo dice en palabras, no solo con forma y color. */
const STATUS_LABEL: Record<SiteDayStatus, string> = {
  ok: 'todo a tiempo',
  late: 'alguna con demora',
  failed: 'alguna no realizada o incompleta',
  pending: 'pendiente de sincronizar o en revisión',
  none: 'sin rondas',
};

// Forma además de color (sistema Foja): lleno en tinta, ámbar, trama roja, punteado o vacío.
const STATUS_CLASS: Record<SiteDayStatus, string> = {
  ok: 'border-foreground bg-foreground',
  late: 'border-warning bg-warning',
  failed: 'border-danger',
  pending: 'border-dashed border-muted-foreground',
  none: 'border-border',
};
const FAILURE_HATCH = 'repeating-linear-gradient(45deg, var(--danger) 0 3px, transparent 3px 7px)';

const dayNumber = (day: string) => String(Number(day.slice(8, 10)));
const dayLabel = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

function Box({ status, className }: { status: SiteDayStatus; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block h-6 min-w-3 border-[1.5px]', STATUS_CLASS[status], className)}
      style={status === 'failed' ? { background: FAILURE_HATCH } : undefined}
    />
  );
}

function cellText(cell: Cell): string {
  const base = `${dayLabel(cell.day)}: ${STATUS_LABEL[cell.status]}`;
  if (cell.percentage === null) return base;
  return `${base} (${cell.percentage.toLocaleString('es-AR', { maximumFractionDigits: 0 })} % de ${cell.evaluated})`;
}

/**
 * Casilleros de la propuesta B: un casillero por predio y por día, para ver de un vistazo dónde y
 * cuándo falló el servicio. Es una tabla real (predios en filas, días en columnas), así el lector
 * de pantalla la recorre; cada casillero lleva su estado escrito.
 */
export function SiteDaysWidget({ item }: WidgetProps) {
  const { days } = adminSummaryCatalog.widgets.siteDays.settings.parse(item.settings);
  const grid = useSiteDayGrid(Number(days));
  const title = `Casilleros por predio · ${days} días`;
  const link = { to: '/cumplimiento', label: 'Ver cumplimiento' };
  if (!grid.data)
    return (
      <WidgetFrame title={title} link={link}>
        <WidgetStatus query={grid} label="los casilleros" />
      </WidgetFrame>
    );
  const { sites } = grid.data;
  const columns = grid.data.days;
  return (
    <WidgetFrame title={title} link={link}>
      {sites.length === 0 ? (
        <WidgetEmpty>Sin predios con rondas en el período.</WidgetEmpty>
      ) : (
        <div className="space-y-3 p-5">
          {/* Solo la tabla se desplaza de costado en celular; tabIndex para llegar con teclado. */}
          <div tabIndex={0} role="region" aria-label="Casilleros" className="overflow-x-auto">
            <table className="w-full min-w-max border-separate border-spacing-1 text-sm">
              <caption className="sr-only">
                Estado de cada predio por día. Cada casillero indica si todas las rondas se hicieron
                a tiempo, con demora o con fallas.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="t-label pr-3 text-left text-muted-foreground">
                    Predio
                  </th>
                  {columns.map((day) => (
                    <th
                      key={day}
                      scope="col"
                      className="t-label px-0 text-center font-normal text-muted-foreground"
                    >
                      <span aria-hidden="true">{dayNumber(day)}</span>
                      <span className="sr-only">{dayLabel(day)}</span>
                    </th>
                  ))}
                  <th scope="col">
                    <span className="sr-only">Resumen</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => {
                  const failedDays = site.cells.filter((cell) => cell.status === 'failed').length;
                  return (
                    <tr key={site.id}>
                      <th scope="row" className="max-w-48 truncate pr-3 text-left font-semibold">
                        {site.name}
                      </th>
                      {site.cells.map((cell) => (
                        <td key={cell.day} title={cellText(cell)} className="p-0">
                          <Box status={cell.status} />
                          <span className="sr-only">{cellText(cell)}</span>
                        </td>
                      ))}
                      <td className="pl-2 whitespace-nowrap">
                        {failedDays > 0 ? (
                          <Stamp variant="fail">
                            {failedDays} {failedDays === 1 ? 'día' : 'días'} con fallas
                          </Stamp>
                        ) : (
                          <Stamp check>En orden</Stamp>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul aria-label="Referencias" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {(['ok', 'late', 'failed', 'pending', 'none'] as const).map((status) => (
              <li key={status} className="flex items-center gap-2">
                <Box status={status} className="w-4" />
                <span className="first-letter:uppercase">{STATUS_LABEL[status]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetFrame>
  );
}

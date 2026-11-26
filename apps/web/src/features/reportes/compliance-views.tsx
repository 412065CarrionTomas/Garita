import type { ComplianceReport } from '@garita/shared';
import { cn } from '@/lib/utils';
import { Stamp } from '@/components/stamp';
import { WindowBar, type WindowStatus } from '@/components/window-bar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { DataTable, type DataColumn } from '@/components/data-table';
import { COMPLIANCE_THRESHOLD } from './charts/compliance-tone';

type Totals = ComplianceReport['totals'];
type Site = ComplianceReport['bySite'][number];

/** Barra de cumplimiento: tinta; bajo el umbral, rayada en rojo (la forma avisa además del color). */
export function ComplianceBar({ value }: { value: number }) {
  const low = value < COMPLIANCE_THRESHOLD;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block h-2.5 w-20 shrink-0 border-[1.5px]',
        low ? 'border-danger' : 'border-foreground',
      )}
    >
      <span
        className="block h-full bg-foreground"
        style={{
          width: `${value}%`,
          ...(low && {
            background:
              'repeating-linear-gradient(45deg, var(--danger) 0 4px, transparent 4px 8px)',
          }),
        }}
      />
    </span>
  );
}

/** Vista Tabla: una fila por predio. Programadas = ventanas evaluadas (fuera de revisión y de sincronización). */
export function SiteComplianceTable({
  sites,
  onSelect,
}: {
  sites: ComplianceReport['bySite'];
  onSelect: (siteId: string) => void;
}) {
  if (sites.length === 0)
    return (
      <EmptyState
        title="Sin datos en este período"
        description="Probá con otro período o quitá algún filtro."
      />
    );
  const percent = (value: number) =>
    `${value.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`;
  const columns: DataColumn<Site>[] = [
    { id: 'name', header: 'Predio', value: (s) => s.name, className: 'font-semibold' },
    ...(
      [
        ['evaluated', 'Programadas', (t: Totals) => t.evaluated],
        ['ontime', 'A tiempo', (t: Totals) => t.complete - t.complete_late],
        ['late', 'Tardías', (t: Totals) => t.complete_late],
        ['incomplete', 'Incompletas', (t: Totals) => t.incomplete],
        ['not_done', 'No realizadas', (t: Totals) => t.not_done],
      ] as const
    ).map(([id, header, read]): DataColumn<Site> => ({
      id,
      header,
      type: 'number',
      align: 'right',
      width: 112,
      value: (s) => read(s.totals),
      className: 't-numeral',
    })),
    {
      id: 'percentage',
      header: 'Cumplimiento',
      type: 'number',
      width: 248,
      value: (s) => s.totals.percentage,
      cell: ({ totals: { percentage } }) =>
        percentage === null ? (
          <span className="text-muted-foreground">Sin datos</span>
        ) : (
          <span className="flex items-center gap-2">
            <ComplianceBar value={percentage} />
            <span className={cn('t-numeral', percentage < COMPLIANCE_THRESHOLD && 'text-danger')}>
              {percent(percentage)}
            </span>
            {percentage < COMPLIANCE_THRESHOLD && (
              <Stamp variant="fail" className="m-0 rotate-0 px-1.5 py-0">
                REVISAR
              </Stamp>
            )}
          </span>
        ),
    },
    {
      id: 'detail',
      header: 'Detalle',
      hideHeader: true,
      width: 128,
      align: 'right',
      cell: (s) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onSelect(s.id);
          }}
          aria-label={`Ver ventanas: ${s.name}`}
        >
          Ver ventanas
        </Button>
      ),
    },
  ];
  return (
    <DataTable
      label="Cumplimiento por predio"
      rows={sites}
      columns={columns}
      getRowId={(s) => s.id}
    />
  );
}

const GRID_DAYS = 14;
// TODO(foja): el informe trae solo totales por día, no cada ventana; la hilera ordena los casilleros
// por estado. Las incompletas se dibujan como no realizadas. Para el orden real hace falta el detalle por ventana.
function dayWindows(t: Totals): { status: WindowStatus }[] {
  const run = (status: WindowStatus, n: number) => Array.from({ length: n }, () => ({ status }));
  return [
    ...run('ontime', t.complete - t.complete_late),
    ...run('late', t.complete_late),
    ...run('missed', t.incomplete + t.not_done),
    ...run('pending', t.in_review + t.pending_sync),
  ];
}
function dayLabel(name: string) {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(name);
  return match ? `${match[2]}/${match[1]}` : name;
}

const legend: { status: WindowStatus; label: string }[] = [
  { status: 'ontime', label: 'A tiempo' },
  { status: 'late', label: 'Tardía' },
  { status: 'missed', label: 'No realizada' },
  { status: 'pending', label: 'En revisión o sin sincronizar' },
];

/** Vista Grilla: una fila por día (hasta 14) con un casillero por ventana. */
export function WindowGrid({ days }: { days: ComplianceReport['daily'] }) {
  const rows = days.slice(-GRID_DAYS).filter(({ totals }) => dayWindows(totals).length > 0);
  if (rows.length === 0)
    return (
      <EmptyState
        title="Sin ventanas en este período"
        description="Probá con otro período o quitá algún filtro."
      />
    );
  return (
    <div className="space-y-4 p-4">
      <ul className="space-y-1.5" aria-label="Ventanas por día">
        {rows.map(({ id, name, totals }) => (
          <li key={id} className="flex items-center gap-4">
            <span className="w-12 shrink-0 font-semibold tabular-nums">{dayLabel(name)}</span>
            <WindowBar
              size="grid"
              windows={dayWindows(totals)}
              className="min-w-0 flex-1 gap-0.5 [&>span]:h-5 [&>span]:min-w-1"
            />
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
        {legend.map(({ status, label }) => (
          <li key={status} className="flex items-center gap-2">
            <WindowBar windows={[{ status }]} className="[&>span]:h-3.5" />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

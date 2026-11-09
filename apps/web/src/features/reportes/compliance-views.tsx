import type { ComplianceReport } from '@garita/shared';
import { cn } from '@/lib/utils';
import { Stamp } from '@/components/stamp';
import { WindowBar, type WindowStatus } from '@/components/window-bar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { COMPLIANCE_THRESHOLD } from './charts/compliance-tone';

type Totals = ComplianceReport['totals'];

/** Barra de cumplimiento: tinta; bajo el umbral, rayada en rojo (la forma avisa además del color). */
function ComplianceBar({ value }: { value: number }) {
  const low = value < COMPLIANCE_THRESHOLD;
  return (
    <span
      aria-hidden="true"
      className={cn('block h-2.5 w-32 border-[1.5px]', low ? 'border-danger' : 'border-foreground')}
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
  return (
    <Table aria-label="Cumplimiento por predio">
      <TableHeader>
        <TableRow>
          <TableHead>Predio</TableHead>
          <TableHead className="text-right">Programadas</TableHead>
          <TableHead className="text-right">A tiempo</TableHead>
          <TableHead className="text-right">Tardías</TableHead>
          <TableHead className="text-right">No realizadas</TableHead>
          <TableHead>Cumplimiento</TableHead>
          <TableHead>
            <span className="sr-only">Detalle</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sites.map(({ id, name, totals }) => {
          const value = totals.percentage;
          return (
            <TableRow key={id}>
              <TableCell className="font-semibold">{name}</TableCell>
              <TableCell className="t-numeral text-right">{totals.evaluated}</TableCell>
              <TableCell className="t-numeral text-right">
                {totals.complete - totals.complete_late}
              </TableCell>
              <TableCell className="t-numeral text-right">{totals.complete_late}</TableCell>
              <TableCell className="t-numeral text-right">{totals.not_done}</TableCell>
              <TableCell>
                {value === null ? (
                  <span className="text-muted-foreground">Sin datos</span>
                ) : (
                  <span className="flex items-center gap-3">
                    <ComplianceBar value={value} />
                    <span className="t-numeral">
                      {value.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %
                    </span>
                    {value < COMPLIANCE_THRESHOLD && <Stamp variant="fail">REVISAR</Stamp>}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onSelect(id);
                  }}
                  aria-label={`Ver ventanas: ${name}`}
                >
                  Ver ventanas
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
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
    <div className="space-y-4">
      <ul className="space-y-2" aria-label="Ventanas por día">
        {rows.map(({ id, name, totals }) => (
          <li key={id} className="flex items-center gap-4">
            <span className="t-numeral w-14 shrink-0">{dayLabel(name)}</span>
            <div className="min-w-0 flex-1 overflow-x-auto">
              <WindowBar size="grid" windows={dayWindows(totals)} />
            </div>
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

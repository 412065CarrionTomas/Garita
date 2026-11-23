import { adminSummaryCatalog } from '@garita/shared';
import { Stamp } from '@/components/stamp';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { COMPLIANCE_THRESHOLD } from '@/features/reportes/charts/compliance-tone';
import { ComplianceBar } from '@/features/reportes/compliance-views';
import { useComplianceReport } from '../queries';
import { sortSites } from '../summary-rows';
import { WidgetEmpty, WidgetFrame, WidgetStatus } from '../widget-frame';
import type { WidgetProps } from './widget-props';

export function SitesWidget({ item }: WidgetProps) {
  const { sort, limit } = adminSummaryCatalog.widgets.sites.settings.parse(item.settings);
  // Comparte el informe de 30 días con el bloque de cumplimiento: un solo pedido.
  const report = useComplianceReport('30d');
  const title = sort === 'worst' ? 'Predios · peor cumplimiento primero' : 'Predios';
  const link = { to: '/cumplimiento', label: 'Ver todos' };
  if (!report.data)
    return (
      <WidgetFrame title={title} link={link}>
        <WidgetStatus query={report} label="los predios" />
      </WidgetFrame>
    );
  const sites = sortSites(report.data.bySite, sort, limit);
  return (
    <WidgetFrame
      title={title}
      link={link}
      aside={<span className="t-label text-muted-foreground">30 días</span>}
    >
      {sites.length === 0 ? (
        <WidgetEmpty>Sin predios con rondas en el período.</WidgetEmpty>
      ) : (
        <Table>
          <caption className="sr-only">Cumplimiento por predio en los últimos 30 días</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Predio</TableHead>
              <TableHead className="text-right">Ventanas</TableHead>
              <TableHead className="text-right">No realizadas</TableHead>
              <TableHead>Cumplimiento</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sites.map((site) => {
              const value = site.totals.percentage;
              return (
                <TableRow key={site.id}>
                  <TableCell className="font-semibold">{site.name}</TableCell>
                  <TableCell className="t-numeral text-right">{site.totals.evaluated}</TableCell>
                  <TableCell className="t-numeral text-right">{site.totals.not_done}</TableCell>
                  <TableCell>
                    {value === null ? (
                      <span className="text-muted-foreground">Sin datos</span>
                    ) : (
                      <span className="flex items-center gap-3">
                        <ComplianceBar value={value} />
                        <span className="t-numeral">
                          {value.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %
                        </span>
                        {value < COMPLIANCE_THRESHOLD && <Stamp variant="fail">Revisar</Stamp>}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </WidgetFrame>
  );
}

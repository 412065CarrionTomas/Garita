import { adminSummaryCatalog } from '@garita/shared';
import { Stamp } from '@/components/stamp';
import { CategoryChart } from '../category-chart';
import { categoryPresentation } from '../summary-rows';
import { useIncidentReport } from '../queries';
import { WidgetFrame, WidgetStatus } from '../widget-frame';
import type { WidgetProps } from './widget-props';

export function IncidentsWidget({ item }: WidgetProps) {
  const { period } = adminSummaryCatalog.widgets.incidents.settings.parse(item.settings);
  const report = useIncidentReport(period);
  const title = `Incidentes · ${period === '7d' ? '7' : '30'} días`;
  const link = { to: '/incidentes-y-respuesta', label: 'Reporte' };
  if (!report.data)
    return (
      <WidgetFrame title={title} link={link}>
        <WidgetStatus query={report} label="los incidentes" />
      </WidgetFrame>
    );
  const { total, pending, byType } = report.data;
  const rows = byType
    .filter((type) => type.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((type) => ({ id: type.id, name: type.name, value: type.value }));
  return (
    <WidgetFrame
      title={title}
      link={link}
      aside={
        pending.count > 0 ? <Stamp variant="late">{pending.count} sin clasificar</Stamp> : undefined
      }
    >
      <p className="px-5 pt-4 text-sm">
        <strong className="t-numeral">{total}</strong> {total === 1 ? 'incidente' : 'incidentes'} en
        el período
      </p>
      <CategoryChart
        rows={rows}
        presentation={categoryPresentation(item.presentation)}
        caption="Incidentes por tipo"
        valueLabel="Incidentes"
      />
    </WidgetFrame>
  );
}

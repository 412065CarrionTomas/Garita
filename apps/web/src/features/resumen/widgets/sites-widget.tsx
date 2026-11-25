import { adminSummaryCatalog } from '@garita/shared';
import { ComplianceRanking } from '../compliance-ranking';
import { useComplianceReport } from '../queries';
import type { WidgetProps } from './widget-props';

/** Predios del período, peor cumplimiento primero, con fijados. */
export function SitesWidget({ item }: WidgetProps) {
  const { sort, limit } = adminSummaryCatalog.widgets.sites.settings.parse(item.settings);
  // Comparte el informe de 30 días con el bloque de cumplimiento: un solo pedido.
  const report = useComplianceReport('30d');
  return (
    <ComplianceRanking
      title={sort === 'worst' ? 'Predios · peor cumplimiento primero' : 'Predios'}
      view={adminSummaryCatalog.key}
      entityType="site"
      rows={report.data?.bySite.map((site) => ({ ...site, pinnable: true }))}
      query={report}
      sort={sort}
      limit={limit}
      nouns={{ column: 'Predio', plural: 'predios' }}
      link={{ to: '/cumplimiento', label: 'Ver todos' }}
    />
  );
}

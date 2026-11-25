import { adminSummaryCatalog } from '@garita/shared';
import { ComplianceRanking } from '../compliance-ranking';
import { useComplianceReport } from '../queries';
import type { WidgetProps } from './widget-props';

// Las ventanas sin vigilador asignado vienen con id nulo: se listan pero no se pueden fijar.
const UNASSIGNED_ID = 'sin-vigilador';

/**
 * Vigiladores del período, peor cumplimiento primero, con fijados. Los desactivados se listan
 * (su historial cuenta) pero no se pueden fijar: la API solo acepta vigiladores activos.
 */
export function GuardsWidget({ item }: WidgetProps) {
  const { sort, limit } = adminSummaryCatalog.widgets.guards.settings.parse(item.settings);
  const report = useComplianceReport('30d');
  return (
    <ComplianceRanking
      title={sort === 'worst' ? 'Vigiladores · peor cumplimiento primero' : 'Vigiladores'}
      view={adminSummaryCatalog.key}
      entityType="guard"
      rows={report.data?.byGuard.map((guard) => ({
        id: guard.id ?? UNASSIGNED_ID,
        name: guard.deactivated ? `${guard.name} (desactivado)` : guard.name,
        totals: guard.totals,
        pinnable: guard.id !== null && !guard.deactivated,
      }))}
      query={report}
      sort={sort}
      limit={limit}
      nouns={{ column: 'Vigilador', plural: 'vigiladores' }}
      link={{ to: '/cumplimiento', label: 'Ver todos' }}
    />
  );
}

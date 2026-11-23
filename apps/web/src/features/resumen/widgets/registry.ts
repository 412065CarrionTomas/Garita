import type { ComponentType } from 'react';
import type { AdminSummaryWidgetId } from '@garita/shared';
import { AccountWidget } from './account-widget';
import { AttentionWidget } from './attention-widget';
import { ComplianceWidget } from './compliance-widget';
import { GuardsWidget } from './guards-widget';
import { IncidentsWidget } from './incidents-widget';
import { ShiftsTodayWidget } from './shifts-today-widget';
import { SitesWidget } from './sites-widget';
import type { WidgetProps } from './widget-props';

/**
 * Componente de cada bloque del catálogo del resumen. `satisfies` obliga a que estén todos: un
 * bloque nuevo en el catálogo sin su componente no compila.
 */
export const summaryWidgets = {
  attention: AttentionWidget,
  compliance: ComplianceWidget,
  shiftsToday: ShiftsTodayWidget,
  sites: SitesWidget,
  guards: GuardsWidget,
  incidents: IncidentsWidget,
  account: AccountWidget,
} satisfies Record<AdminSummaryWidgetId, ComponentType<WidgetProps>>;

export function summaryWidget(id: string): ComponentType<WidgetProps> | undefined {
  return Object.hasOwn(summaryWidgets, id) ? summaryWidgets[id as AdminSummaryWidgetId] : undefined;
}

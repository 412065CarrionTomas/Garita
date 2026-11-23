import type { AdminSummaryWidgetId } from '@garita/shared';
import type { BlockDescription, Choice } from '@/lib/layout-grid/blocks-panel';
import { widgetTitle } from './summary-rows';

/** Nombre visible de cada presentación que usa el resumen. */
const PRESENTATION_LABELS: Readonly<Record<string, string>> = {
  table: 'Tabla',
  column: 'Columna',
  line: 'Líneas',
  bars: 'Barras',
  pie: 'Torta',
  strip: 'Franja',
};

const PERIOD: readonly Choice[] = [
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
];

/**
 * Presentaciones (en el orden del catálogo) y ajustes de cada bloque, con sus textos. Los valores
 * deben coincidir con el catálogo compartido: un test lo verifica.
 */
const SUMMARY_BLOCKS = {
  attention: { presentations: ['table', 'column'], settings: [] },
  compliance: {
    presentations: ['line', 'bars', 'table'],
    settings: [{ key: 'period', label: 'Período', options: PERIOD }],
  },
  shiftsToday: { presentations: ['bars', 'pie', 'table'], settings: [] },
  sites: {
    presentations: ['table'],
    settings: [
      {
        key: 'sort',
        label: 'Orden',
        options: [
          { value: 'worst', label: 'Peor primero' },
          { value: 'name', label: 'Por nombre' },
        ],
      },
      {
        key: 'limit',
        label: 'Cantidad',
        options: [
          { value: '5', label: '5' },
          { value: '10', label: '10' },
          { value: 'all', label: 'Todos' },
        ],
      },
    ],
  },
  guards: {
    presentations: ['table'],
    settings: [
      {
        key: 'sort',
        label: 'Orden',
        options: [
          { value: 'worst', label: 'Peor primero' },
          { value: 'name', label: 'Por nombre' },
        ],
      },
      {
        key: 'limit',
        label: 'Cantidad',
        options: [
          { value: '5', label: '5' },
          { value: '10', label: '10' },
          { value: 'all', label: 'Todos' },
        ],
      },
    ],
  },
  incidents: {
    presentations: ['bars', 'pie', 'table'],
    settings: [{ key: 'period', label: 'Período', options: PERIOD }],
  },
  account: { presentations: ['strip'], settings: [] },
} satisfies Record<
  AdminSummaryWidgetId,
  { presentations: readonly string[]; settings: BlockDescription['settings'] }
>;

export function describeSummaryBlock(id: string): BlockDescription {
  const blocks: Readonly<
    Record<string, (typeof SUMMARY_BLOCKS)[AdminSummaryWidgetId] | undefined>
  > = SUMMARY_BLOCKS;
  const block = blocks[id];
  return {
    title: widgetTitle(id),
    presentations: (block?.presentations ?? []).map((value) => ({
      value,
      label: PRESENTATION_LABELS[value] ?? value,
    })),
    settings: block?.settings ?? [],
  };
}

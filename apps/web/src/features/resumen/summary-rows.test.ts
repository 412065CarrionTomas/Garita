import { computeCompliance, type ComplianceReport } from '@garita/shared';
import type { ShiftRow } from '@/features/supervision/contracts';
import {
  categoryPresentation,
  shiftStatusRows,
  sortByCompliance,
  widgetTitle,
} from './summary-rows';

const shift = (id: string, status: ShiftRow['status']): ShiftRow => ({
  id,
  site: { id: 'p1', name: 'Depósito' },
  startsAt: '2026-11-23T06:00:00Z',
  endsAt: '2026-11-23T14:00:00Z',
  status,
  syncStatus: null,
  assignment: null,
  windows: {},
});

describe('shiftStatusRows', () => {
  it('cuenta por estado, une etiquetas iguales y marca solo las excepciones', () => {
    const rows = shiftStatusRows([
      shift('1', 'in_progress'),
      shift('2', 'in_progress'),
      shift('3', 'uncovered'),
      shift('4', 'without_guard'),
      shift('5', 'unassigned'),
    ]);
    expect(rows).toEqual([
      { id: 'in_progress', name: 'En curso', value: 2, tone: undefined },
      { id: 'uncovered', name: 'Sin cobertura', value: 1, tone: 'failure' },
      { id: 'without_guard', name: 'Sin vigilador', value: 2, tone: 'delay' },
    ]);
  });
});

describe('sortByCompliance', () => {
  const totals = computeCompliance([], 'UTC').totals;
  const site = (id: string, name: string, percentage: number | null) => ({
    id,
    name,
    totals: { ...totals, percentage },
  });
  const sites: ComplianceReport['bySite'] = [
    site('a', 'Oficinas', 98),
    site('b', 'Depósito', 82),
    site('c', 'Country', null),
    site('d', 'Barrio', 82),
  ];

  it('ordena del peor al mejor, desempata por nombre y deja sin datos al final', () => {
    expect(sortByCompliance(sites, 'worst', 'all').map((s) => s.id)).toEqual(['d', 'b', 'a', 'c']);
  });

  it('ordena por nombre y respeta el límite', () => {
    expect(sortByCompliance(sites, 'name', '5').map((s) => s.name)).toEqual([
      'Barrio',
      'Country',
      'Depósito',
      'Oficinas',
    ]);
    expect(sortByCompliance([...sites, ...sites, ...sites], 'worst', '10')).toHaveLength(10);
  });
});

it('estrecha presentaciones y títulos sin fallar ante valores desconocidos', () => {
  expect(categoryPresentation('pie')).toBe('pie');
  expect(categoryPresentation('table')).toBe('table');
  expect(categoryPresentation('otra')).toBe('bars');
  expect(widgetTitle('compliance')).toBe('Cumplimiento');
  expect(widgetTitle('borrado')).toBe('borrado');
});

import type { ResponseTimesReport, ResponseTimeSummary } from '@garita/shared';
import { useState } from 'react';
import { DataTable, type DataColumn } from '@/components/data-table';
import { SegmentedFilter } from '@/components/segmented-filter';
import { minutes } from './format';

interface Row {
  id: string;
  name: string;
  times: ResponseTimesReport['totals'];
}

const timeColumns = (key: 'panic' | 'classification', label: string): DataColumn<Row>[] => [
  {
    id: `${key}-avg`,
    header: `${label} · promedio`,
    type: 'number',
    align: 'right',
    width: 170,
    value: (row) => row.times[key].averageMs,
    cell: (row) => <span className="tabular-nums">{minutes(row.times[key].averageMs)}</span>,
  },
  {
    id: `${key}-max`,
    header: `${label} · máximo`,
    type: 'number',
    align: 'right',
    width: 160,
    value: (row) => row.times[key].maximumMs,
    cell: (row) => <span className="tabular-nums">{minutes(row.times[key].maximumMs)}</span>,
  },
];
const unanswered = (summary: ResponseTimeSummary) => summary.unanswered;

/**
 * Tiempos de respuesta en una sola tabla: una fila por predio (o supervisor) y las columnas de
 * pánico y clasificación lado a lado. Rondas incumplidas se mide en Cumplimiento.
 */
export function ResponseTimes({ data, isAdmin }: { data: ResponseTimesReport; isAdmin: boolean }) {
  const [view, setView] = useState<'predios' | 'supervisores'>('predios');
  const rows: Row[] =
    view === 'supervisores' && 'bySupervisor' in data
      ? data.bySupervisor
      : 'own' in data && view === 'supervisores'
        ? [data.own]
        : data.bySite;
  return (
    <section aria-labelledby="response-times-title" className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 id="response-times-title" className="t-headline">
            Tiempos de respuesta
          </h2>
          <p className="text-muted-foreground">
            Pánico: del envío a la confirmación. Clasificación: de la recepción a la primera
            decisión. Lo que no tuvo respuesta queda fuera del promedio.
          </p>
        </div>
        <SegmentedFilter
          ariaLabel="Agrupar tiempos por"
          options={[
            { value: 'predios', label: 'Por predio' },
            { value: 'supervisores', label: isAdmin ? 'Por supervisor' : 'Mis tiempos' },
          ]}
          value={view}
          onChange={setView}
        />
      </header>
      <div className="overflow-x-auto border-[1.5px] border-input">
        <DataTable<Row>
          label={view === 'predios' ? 'Tiempos por predio' : 'Tiempos por supervisor'}
          rows={rows}
          getRowId={(row) => row.id}
          columns={[
            {
              id: 'name',
              header: view === 'predios' ? 'Predio' : 'Supervisor',
              value: (row) => row.name,
              cell: (row) => <span className="font-semibold">{row.name}</span>,
            },
            ...timeColumns('panic', 'Pánico'),
            ...timeColumns('classification', 'Clasificación'),
            {
              id: 'unanswered',
              header: 'Sin respuesta',
              type: 'number',
              align: 'right',
              width: 130,
              value: (row) => unanswered(row.times.panic) + unanswered(row.times.classification),
            },
            {
              id: 'escalated',
              header: 'Pánicos escalados',
              type: 'number',
              align: 'right',
              width: 150,
              value: (row) => row.times.panic.escalated,
            },
          ]}
        />
      </div>
      {!rows.length && <p className="text-muted-foreground">Sin datos en el período.</p>}
    </section>
  );
}

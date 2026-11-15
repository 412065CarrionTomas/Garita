import type { ResponseTimesReport, ResponseTimeSummary } from '@garita/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const indicators = [
  { key: 'panic', label: 'Pánico' },
  { key: 'missedRound', label: 'Rondas incumplidas' },
  { key: 'classification', label: 'Clasificación de incidentes' },
] as const;
function duration(value: number | null) {
  return value === null
    ? 'Sin datos'
    : `${(value / 60000).toLocaleString('es-AR', { maximumFractionDigits: 2 })} min`;
}
function TimeTable({
  title,
  rows,
}: {
  title: string;
  rows: {
    id: string;
    name: string;
    times: Record<(typeof indicators)[number]['key'], ResponseTimeSummary>;
  }[];
}) {
  return (
    <Table aria-label={title}>
      <TableHeader>
        <TableRow>
          <TableHead>Nombre</TableHead>
          <TableHead>Indicador</TableHead>
          <TableHead>Promedio</TableHead>
          <TableHead>Máximo</TableHead>
          <TableHead>Con respuesta</TableHead>
          <TableHead>Sin respuesta</TableHead>
          <TableHead>Escaladas</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.flatMap((row) =>
          indicators.map((indicator) => (
            <TableRow key={`${row.id}-${indicator.key}`}>
              <TableCell>{row.name}</TableCell>
              <TableCell>{indicator.label}</TableCell>
              <TableCell>{duration(row.times[indicator.key].averageMs)}</TableCell>
              <TableCell>{duration(row.times[indicator.key].maximumMs)}</TableCell>
              <TableCell>{row.times[indicator.key].count}</TableCell>
              <TableCell>{row.times[indicator.key].unanswered}</TableCell>
              <TableCell>{row.times[indicator.key].escalated}</TableCell>
            </TableRow>
          )),
        )}
      </TableBody>
    </Table>
  );
}
export function ResponseTimes({ data, isAdmin }: { data: ResponseTimesReport; isAdmin: boolean }) {
  return (
    <section aria-labelledby="response-times-title" className="space-y-4">
      <h2 id="response-times-title" className="t-headline">
        Tiempos de respuesta
      </h2>
      <p>
        Desde el envío del pánico, la creación del aviso o la recepción del incidente. Sin respuesta
        queda fuera del promedio. Indicadores del equipo, no una sanción.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        {indicators.map(({ key, label }) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle>
                <h3>{label}</h3>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 tabular-nums">
              <p>Promedio: {duration(data.totals[key].averageMs)}</p>
              <p>Máximo: {duration(data.totals[key].maximumMs)}</p>
              <p>
                {data.totals[key].count} con respuesta · {data.totals[key].unanswered} sin respuesta
              </p>
              {key === 'panic' && <p>{data.totals.panic.escalated} alertas escaladas</p>}
            </CardContent>
          </Card>
        ))}
      </div>
      <h3 className="t-title">Tiempos por predio</h3>
      <TimeTable title="Tiempos por predio" rows={data.bySite} />
      {isAdmin && 'bySupervisor' in data && (
        <>
          <h3 className="t-title">Comparación por supervisor</h3>
          <TimeTable title="Comparación por supervisor" rows={data.bySupervisor} />
        </>
      )}
      {!isAdmin && 'own' in data && (
        <>
          <h3 className="t-title">Tus tiempos</h3>
          <TimeTable title="Tus tiempos" rows={[data.own]} />
        </>
      )}
    </section>
  );
}

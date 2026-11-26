import { WEEKDAY_LABELS } from '@garita/shared';
import { cn } from '@/lib/utils';

const BANDS = Array.from({ length: 12 }, (_, i) => i * 2);
// Cinco escalones de tinta; el número va siempre escrito, el tono solo ayuda a ver el patrón.
const STEPS = ['bg-transparent', 'bg-primary/15', 'bg-primary/35', 'bg-primary/60', 'bg-primary'];

/**
 * Mapa de calor día de la semana × franja de 2 h. Es una tabla real: cada celda es un botón que
 * abre el detalle de ese día y franja.
 */
export function Heatmap({
  grid,
  onSelect,
}: {
  grid: number[][];
  onSelect: (day: number, band: number, label: string) => void;
}) {
  const max = Math.max(0, ...grid.flat());
  const step = (value: number) =>
    value === 0 ? 0 : Math.min(4, Math.ceil((value / Math.max(1, max)) * 4));
  const dayTotals = grid.map((row) => row.reduce((a, b) => a + b, 0));
  const bandTotals = BANDS.map((_, band) => grid.reduce((sum, row) => sum + (row[band] ?? 0), 0));
  return (
    <section className="space-y-3 border-[1.5px] border-input bg-card p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold">Cuándo ocurren: día × franja horaria</h3>
        <p className="text-sm text-muted-foreground">
          Tocá una celda para ver esos incidentes. Hora de la empresa.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-center tabular-nums">
          <caption className="sr-only">
            Incidentes por día de la semana y franja de dos horas
          </caption>
          <thead>
            <tr>
              <th scope="col" className="w-14" />
              {BANDS.map((band) => (
                <th
                  key={band}
                  scope="col"
                  className="pb-1 text-sm font-medium text-muted-foreground"
                >
                  {String(band).padStart(2, '0')}
                </th>
              ))}
              <th scope="col" className="w-14 pb-1 text-sm font-semibold">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {grid.map((row, day) => (
              <tr key={WEEKDAY_LABELS[day]}>
                <th scope="row" className="pr-2 text-left font-semibold">
                  {WEEKDAY_LABELS[day]}
                </th>
                {row.map((value, band) => {
                  const level = step(value);
                  const from = String(band * 2).padStart(2, '0');
                  const to = String(band * 2 + 2).padStart(2, '0');
                  const label = `${WEEKDAY_LABELS[day] ?? ''} ${from}–${to} h`;
                  return (
                    <td key={band} className="p-0.5">
                      <button
                        type="button"
                        disabled={value === 0}
                        aria-label={`${label}: ${String(value)} incidentes`}
                        onClick={() => {
                          onSelect(day, band * 2, label);
                        }}
                        className={cn(
                          'h-10 w-full rounded-sm border border-border text-base font-semibold',
                          STEPS[level],
                          level >= 3 ? 'text-primary-foreground' : 'text-foreground',
                          value === 0 ? 'text-muted-foreground' : 'hover:ring-2 hover:ring-ring',
                        )}
                      >
                        {value || '·'}
                      </button>
                    </td>
                  );
                })}
                <td className="font-semibold">{dayTotals[day]}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="pt-1 pr-2 text-left font-semibold">
                Total
              </th>
              {bandTotals.map((value, band) => (
                <td key={BANDS[band]} className="pt-1 font-semibold">
                  {value}
                </td>
              ))}
              <td className="pt-1 font-semibold">{dayTotals.reduce((a, b) => a + b, 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

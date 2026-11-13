import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { reportDetailResponseSchema } from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { EmptyState } from '@/components/empty-state';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const SHOWN = 8;

/** Las ventanas no realizadas más recientes del período, siempre visibles debajo de la vista elegida. */
export function NotDoneList({ query, timezone }: { query: string; timezone: string }) {
  const result = useQuery({
    queryKey: ['reports', 'not-done', query],
    queryFn: () =>
      apiGet(
        `/reportes/rondas/detalle?${query}&estado=not_done&pageSize=${SHOWN}&orden=desc`,
        reportDetailResponseSchema,
      ),
  });
  const items = [...(result.data?.items ?? [])]
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))
    .slice(0, SHOWN);
  const hour = (value: string) =>
    new Date(value).toLocaleTimeString('es-AR', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  return (
    <section aria-labelledby="not-done-title" className="space-y-3">
      <h2 id="not-done-title" className="t-headline text-foreground">
        No realizadas
      </h2>
      {result.isPending && (
        <div role="status" aria-label="Cargando no realizadas" className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
      {result.isError && (
        <Alert variant="destructive">
          No pudimos cargar las ventanas no realizadas.{' '}
          <Button variant="outline" size="sm" onClick={() => void result.refetch()}>
            Reintentar
          </Button>
        </Alert>
      )}
      {result.data && items.length === 0 && (
        <EmptyState
          title="Sin ventanas no realizadas"
          description="En este período se cumplieron todas."
        />
      )}
      {items.length > 0 && (
        <Table aria-labelledby="not-done-title">
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Ventana</TableHead>
              <TableHead>Predio</TableHead>
              <TableHead>Vigilador</TableHead>
              <TableHead>
                <span className="sr-only">Detalle</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="t-numeral">
                  {new Date(item.startsAt).toLocaleDateString('es-AR', {
                    timeZone: timezone,
                    day: '2-digit',
                    month: '2-digit',
                  })}
                </TableCell>
                <TableCell className="t-numeral">
                  {hour(item.startsAt)}–{hour(item.endsAt)}
                </TableCell>
                <TableCell className="font-semibold">{item.site.name}</TableCell>
                <TableCell>
                  {item.guard
                    ? `${item.guard.name}${item.guard.deactivated ? ' (desactivado)' : ''}`
                    : 'Sin vigilador'}
                </TableCell>
                <TableCell>
                  {/* TODO(foja): falta el motivo ("Sin señal: sin registros" / "Sin explicación"); la API no lo trae. */}
                  <Link
                    className="underline"
                    to={`/supervision/turnos/${item.shiftId}`}
                    aria-label={`Ver foja: ${item.site.name} ${hour(item.startsAt)}`}
                  >
                    Ver foja
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertTriangleIcon, ArrowRightIcon, ClockIcon } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { shiftLabels, shiftListSchema, shiftTones, syncLabel, time } from './contracts';

export function SupervisionPage() {
  const [status, setStatus] = useState('');
  const [site, setSite] = useState('');
  const {
    data: rows = [],
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['supervision', 'turnos'],
    queryFn: () => apiGet('/supervision/turnos', shiftListSchema),
  });
  const sites = useMemo(
    () => [...new Map(rows.map((row) => [row.site.id, row.site])).values()],
    [rows],
  );
  const visible = useMemo(
    () =>
      rows.filter((row) => (!status || row.status === status) && (!site || row.site.id === site)),
    [rows, status, site],
  );
  return (
    <section aria-labelledby="supervision-title" className="space-y-6">
      <PageHeader
        id="supervision-title"
        title="En vivo"
        description="Estado de los turnos de tus predios, actualizado automáticamente."
      />
      <div className="flex flex-wrap gap-4">
        <div className="space-y-2">
          <Label htmlFor="status-filter">Estado</Label>
          <NativeSelect
            id="status-filter"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
            }}
          >
            <NativeSelectOption value="">Todos los estados</NativeSelectOption>
            {Object.entries(shiftLabels)
              .filter(([key]) => key !== 'unassigned')
              .map(([key, label]) => (
                <NativeSelectOption key={key} value={key}>
                  {label}
                </NativeSelectOption>
              ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="site-filter">Predio</Label>
          <NativeSelect
            id="site-filter"
            value={site}
            onChange={(event) => {
              setSite(event.target.value);
            }}
          >
            <NativeSelectOption value="">Todos los predios</NativeSelectOption>
            {sites.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      {isPending ? (
        <p role="status">Cargando turnos…</p>
      ) : isError ? (
        <Alert role="alert">
          No pudimos cargar los turnos.{' '}
          <button type="button" className="underline" onClick={() => void refetch()}>
            Reintentar
          </button>
        </Alert>
      ) : visible.length === 0 ? (
        <EmptyState title="No hay turnos para estos filtros" />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Turnos en vivo">
          {visible.map((row) => (
            <li key={row.id}>
              <Card
                className={
                  row.status === 'without_guard' ||
                  row.status === 'uncovered' ||
                  row.status === 'unassigned'
                    ? 'border-warning'
                    : undefined
                }
              >
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="font-semibold">{row.site.name}</h2>
                      <p className="text-sm text-muted-foreground tabular-nums">
                        {time(row.startsAt)}–{time(row.endsAt)}
                      </p>
                    </div>
                    <StatusBadge tone={shiftTones[row.status]}>
                      {shiftLabels[row.status]}
                    </StatusBadge>
                  </div>
                  <p className="flex items-center gap-2 text-sm">
                    {row.status === 'without_guard' ||
                    row.status === 'unassigned' ||
                    row.status === 'uncovered' ? (
                      <AlertTriangleIcon aria-hidden="true" className="size-4" />
                    ) : (
                      <ClockIcon aria-hidden="true" className="size-4" />
                    )}
                    {syncLabel(row.syncStatus) ??
                      (row.assignment?.guard
                        ? `${row.assignment.guard.firstName} ${row.assignment.guard.lastName}`
                        : 'Sin vigilador asignado')}
                  </p>
                  <Link
                    to={`/supervision/turnos/${row.id}`}
                    className="inline-flex items-center gap-2 rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Ver detalle <ArrowRightIcon aria-hidden="true" className="size-4" />
                  </Link>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

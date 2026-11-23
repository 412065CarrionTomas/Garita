import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { apiGet } from '@/lib/api-client';
import { panicListSchema, panicStatuses } from './queries';
import { SmsBadges } from './sms-badges';

export function PanicListPage() {
  const [filters, setFilters] = useState({ estado: '', predio: '', pagina: 1 });
  const params = new URLSearchParams({ pagina: String(filters.pagina) });
  if (filters.estado) params.set('estado', filters.estado);
  if (filters.predio) params.set('predio', filters.predio);
  const list = useQuery({
    queryKey: ['panico', 'list', filters],
    queryFn: () => apiGet(`/alertas-panico?${params}`, panicListSchema),
    refetchInterval: 15000,
  });
  const sites = useQuery({
    queryKey: ['sites'],
    queryFn: () => apiGet('/predios', z.array(z.object({ id: z.string(), name: z.string() }))),
  });
  return (
    <section className="space-y-6" aria-label="Alertas de pánico">
      <PageHeader
        title="Alertas de pánico"
        description="Recibí, confirmá y resolvé las emergencias de tus predios"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="panic-status">Estado</Label>
          <NativeSelect
            className="w-full"
            id="panic-status"
            value={filters.estado}
            onChange={(event) => {
              setFilters((old) => ({ ...old, estado: event.target.value, pagina: 1 }));
            }}
          >
            <NativeSelectOption value="">Todos</NativeSelectOption>
            {Object.entries(panicStatuses).map(([value, label]) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="panic-site">Predio</Label>
          <NativeSelect
            className="w-full"
            id="panic-site"
            value={filters.predio}
            onChange={(event) => {
              setFilters((old) => ({ ...old, predio: event.target.value, pagina: 1 }));
            }}
          >
            <NativeSelectOption value="">Todos</NativeSelectOption>
            {sites.data?.map((site) => (
              <NativeSelectOption key={site.id} value={site.id}>
                {site.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      {list.isPending ? (
        <div role="status" className="space-y-2">
          <span className="sr-only">Cargando alertas…</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : list.isError ? (
        <Alert variant="destructive">
          No se pudieron cargar las alertas.{' '}
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            Reintentar
          </Button>
        </Alert>
      ) : (
        <>
          {list.data.items.length ? (
            <ul className="divide-y divide-border border-[1.5px] border-input">
              {list.data.items.map((alert) => (
                <li
                  key={alert.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-3"
                >
                  <div className="space-y-1">
                    <p className="font-semibold">
                      {alert.site.name} · {alert.guard.name}
                    </p>
                    <p className="text-sm text-muted-foreground tabular-nums">
                      Enviada: {new Date(alert.triggeredAt).toLocaleString('es-AR')} · Recibida:{' '}
                      {new Date(alert.receivedAt).toLocaleString('es-AR')}
                    </p>
                    <StatusBadge
                      tone={
                        alert.status === 'active'
                          ? 'danger'
                          : alert.status === 'confirmed'
                            ? 'info'
                            : 'success'
                      }
                    >
                      {panicStatuses[alert.status]}
                    </StatusBadge>
                    <SmsBadges {...alert} />
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/alertas-panico/${alert.id}`}>Ver alerta</Link>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No hay alertas para estos filtros" />
          )}
          <nav aria-label="Páginas de alertas" className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={filters.pagina <= 1}
              onClick={() => {
                setFilters((old) => ({ ...old, pagina: old.pagina - 1 }));
              }}
            >
              Anterior
            </Button>
            <span>
              Página {filters.pagina} de{' '}
              {Math.max(1, Math.ceil(list.data.total / list.data.pageSize))}
            </span>
            <Button
              variant="outline"
              disabled={filters.pagina * list.data.pageSize >= list.data.total}
              onClick={() => {
                setFilters((old) => ({ ...old, pagina: old.pagina + 1 }));
              }}
            >
              Siguiente
            </Button>
          </nav>
        </>
      )}
    </section>
  );
}

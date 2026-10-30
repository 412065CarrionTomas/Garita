import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { apiGet } from '@/lib/api-client';
import { panicListSchema, panicStatuses } from './queries';

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
        <p role="status">Cargando alertas…</p>
      ) : list.isError ? (
        <Alert variant="destructive">No se pudieron cargar las alertas.</Alert>
      ) : (
        <>
          {list.data.items.length ? (
            <ul className="space-y-3">
              {list.data.items.map((alert) => (
                <li key={alert.id}>
                  <Card>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                      <div className="space-y-2">
                        <p className="font-medium">
                          {alert.site.name} · {alert.guard.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Recibida: {new Date(alert.receivedAt).toLocaleString('es-AR')}
                        </p>
                        <StatusBadge
                          tone={
                            alert.status === 'active'
                              ? 'danger'
                              : alert.status === 'confirmed'
                                ? 'warning'
                                : 'success'
                          }
                        >
                          {panicStatuses[alert.status]}
                        </StatusBadge>
                      </div>
                      <Button variant="outline" asChild>
                        <Link to={`/alertas-panico/${alert.id}`}>Ver alerta</Link>
                      </Button>
                    </CardContent>
                  </Card>
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

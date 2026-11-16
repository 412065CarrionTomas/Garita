import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { smsInboundListSchema } from '@garita/shared';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { apiGet } from '@/lib/api-client';

const results = { valid: 'Válido', unverified: 'No verificado', unknown: 'Desconocido' };
export function SmsInboundPage() {
  const [estado, setEstado] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ pagina: String(page) });
  if (estado) params.set('estado', estado);
  const list = useQuery({
    queryKey: ['sms-recibidos', estado, page],
    queryFn: () => apiGet(`/sms-recibidos?${params}`, smsInboundListSchema),
  });
  return (
    <section className="space-y-6" aria-label="SMS recibidos">
      <PageHeader
        title="SMS recibidos"
        description="Revisá los mensajes de tu empresa y su autenticación"
      />
      <div>
        <Label htmlFor="sms-state">Estado</Label>
        <NativeSelect
          id="sms-state"
          value={estado}
          onChange={(event) => {
            setEstado(event.target.value);
            setPage(1);
          }}
        >
          <NativeSelectOption value="">Todos</NativeSelectOption>
          {Object.entries(results).map(([value, label]) => (
            <NativeSelectOption key={value} value={value}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {list.isPending ? (
        <p role="status">Cargando SMS…</p>
      ) : list.isError ? (
        <Alert variant="destructive">
          No se pudieron cargar los SMS.{' '}
          <Button variant="outline" onClick={() => void list.refetch()}>
            Reintentar
          </Button>
        </Alert>
      ) : (
        <>
          {list.data.items.length ? (
            <ul className="divide-y divide-border">
              {list.data.items.map((sms) => (
                <li key={sms.id} className="space-y-3 py-3">
                  <StatusBadge tone={sms.result === 'valid' ? 'info' : 'danger'}>
                    {results[sms.result]}
                  </StatusBadge>
                  <p>Origen: {sms.fromOriginal}</p>
                  <p className="whitespace-pre-wrap break-words">{sms.text}</p>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    Recibido por la pasarela:{' '}
                    {new Date(sms.gatewayReceivedAt).toLocaleString('es-AR')} · Plataforma:{' '}
                    {new Date(sms.receivedAt).toLocaleString('es-AR')}
                  </p>
                  {sms.alertId && (
                    <Button variant="outline" asChild>
                      <Link to={`/alertas-panico/${sms.alertId}`}>Ver alerta</Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No hay SMS para estos filtros" />
          )}
          <nav aria-label="Páginas de SMS" className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={page <= 1}
              onClick={() => {
                setPage(page - 1);
              }}
            >
              Anterior
            </Button>
            <span aria-live="polite">
              Página {page} de {Math.max(1, Math.ceil(list.data.total / list.data.pageSize))}
            </span>
            <Button
              variant="outline"
              disabled={page * list.data.pageSize >= list.data.total}
              onClick={() => {
                setPage(page + 1);
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

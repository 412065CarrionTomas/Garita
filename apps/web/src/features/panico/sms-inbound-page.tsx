import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Search } from 'lucide-react';
import { smsInboundListSchema } from '@garita/shared';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Pagination } from '@/components/pagination';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiGet } from '@/lib/api-client';
import { useDebouncedSearch } from '@/lib/use-debounced-search';
import { cn } from '@/lib/utils';

const results = { valid: 'Válido', unverified: 'No verificado', unknown: 'Desconocido' };
const SUMMARY = [
  { value: 'valid', label: 'Válidos' },
  { value: 'unverified', label: 'No verificados' },
  { value: 'unknown', label: 'Desconocidos' },
] as const;
/** La hora de la pasarela solo se muestra si el SMS tardó más que esto en llegar. */
const GATEWAY_DELAY_MS = 60_000;
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

export function SmsInboundPage() {
  const [estado, setEstado] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // Busca solo cuando se deja de tipear, sin botón de buscar.
  const { input: searchInput, setInput: setSearchInput, search } = useDebouncedSearch(setPage);
  const params = new URLSearchParams({ pagina: String(page), porPagina: String(pageSize) });
  if (estado) params.set('estado', estado);
  if (search) params.set('buscar', search);
  const list = useQuery({
    queryKey: ['sms-recibidos', estado, search, page, pageSize],
    queryFn: () => apiGet(`/sms-recibidos?${params.toString()}`, smsInboundListSchema),
    // Mantiene la tabla mientras llega la página nueva: buscar no parpadea.
    placeholderData: keepPreviousData,
  });
  const changeEstado = (value: string) => {
    setEstado(value);
    setPage(1);
  };
  return (
    <section className="space-y-6" aria-label="SMS recibidos">
      <PageHeader
        title="SMS recibidos"
        description="Revisá los mensajes de tu empresa y su autenticación"
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-80">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Buscar SMS"
            placeholder="Buscar por número o texto"
            className="pl-9"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
            }}
          />
        </div>
        <NativeSelect
          aria-label="Estado"
          value={estado}
          onChange={(event) => {
            changeEstado(event.target.value);
          }}
        >
          <NativeSelectOption value="">Todos los estados</NativeSelectOption>
          {Object.entries(results).map(([value, label]) => (
            <NativeSelectOption key={value} value={value}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {list.data && (
          <div role="group" aria-label="Resumen de SMS" className="flex flex-wrap gap-2">
            {SUMMARY.map(({ value, label }) => {
              const count = list.data.resumen[value];
              const pressed = estado === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => {
                    changeEstado(pressed ? '' : value);
                  }}
                  className={cn(
                    'flex min-h-9 items-baseline gap-2 rounded-md border-[1.5px] px-3 py-1.5 text-sm transition-colors',
                    pressed
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-card hover:bg-muted',
                    !pressed && value === 'unknown' && count > 0 && 'border-danger text-danger',
                  )}
                >
                  <span className="text-base font-semibold tabular-nums">{count}</span>
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {list.isPending ? (
        <div role="status" className="space-y-3">
          <span className="sr-only">Cargando SMS…</span>
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-12 w-full" />
          ))}
        </div>
      ) : list.isError ? (
        <Alert variant="destructive">
          No se pudieron cargar los SMS.{' '}
          <Button variant="outline" onClick={() => void list.refetch()}>
            Reintentar
          </Button>
        </Alert>
      ) : (
        <div className="space-y-4">
          {list.data.items.length ? (
            <Card className="min-w-0 overflow-hidden py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {['Recibido', 'Origen', 'Mensaje', 'Estado', 'Alerta'].map((heading) => (
                      <TableHead key={heading}>{heading}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data.items.map((sms) => {
                    const delayed =
                      Date.parse(sms.receivedAt) - Date.parse(sms.gatewayReceivedAt) >
                      GATEWAY_DELAY_MS;
                    return (
                      <TableRow key={sms.id}>
                        <TableCell className="tabular-nums">
                          <span className="block">{dateTime(sms.receivedAt)}</span>
                          {delayed && (
                            <span className="text-sm text-muted-foreground">
                              Pasarela: {dateTime(sms.gatewayReceivedAt)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="block tabular-nums">{sms.fromOriginal}</span>
                          {sms.sender && (
                            <span className="text-sm text-muted-foreground">
                              {sms.sender.guardName ?? 'Sin vigilador'} · {sms.sender.siteName}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="min-w-64 whitespace-pre-wrap break-words">
                          {sms.text}
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={sms.result === 'valid' ? 'info' : 'danger'}>
                            {results[sms.result]}
                          </StatusBadge>
                        </TableCell>
                        <TableCell>
                          {sms.alertId ? (
                            <Link
                              to={`/alertas-panico/${sms.alertId}`}
                              className="font-semibold underline-offset-4 hover:underline"
                            >
                              Ver alerta
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          ) : (
            <EmptyState title="No hay SMS para estos filtros" />
          )}
          <Pagination
            page={page}
            pages={Math.ceil(list.data.total / pageSize)}
            pageSize={pageSize}
            total={list.data.total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </div>
      )}
    </section>
  );
}

import { Link } from 'react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NOTICE_KINDS, noticesListResponseSchema } from '@garita/shared';
import { z } from 'zod';
import { apiGet } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { noticeLabels } from './labels';
import { NoticeRow } from './notice-row';

export function NoticesPage() {
  const [status, setStatus] = useState('open');
  const [kind, setKind] = useState('');
  const [siteId, setSiteId] = useState('');
  const params = new URLSearchParams();
  if (status) params.set('estado', status);
  if (kind) params.set('tipo', kind);
  if (siteId) params.set('predio', siteId);
  const notices = useQuery({
    queryKey: ['avisos', 'list', status, kind, siteId],
    queryFn: () => apiGet(`/avisos?${params}`, noticesListResponseSchema),
  });
  const sites = useQuery({
    queryKey: ['sites'],
    queryFn: () => apiGet('/predios', z.array(z.object({ id: z.string(), name: z.string() }))),
  });
  return (
    <section aria-labelledby="notices-title" className="space-y-6">
      <PageHeader
        id="notices-title"
        title="Avisos"
        actions={
          <Button asChild variant="outline">
            <Link to="/avisos/preferencias">Preferencias de notificación</Link>
          </Button>
        }
        description="Avisos de tus predios y su historial de resolución."
      />
      <div className="flex flex-wrap gap-4">
        <div className="space-y-2">
          <Label htmlFor="notice-kind">Tipo</Label>
          <NativeSelect
            id="notice-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
            }}
          >
            <NativeSelectOption value="">Todos los tipos</NativeSelectOption>
            {NOTICE_KINDS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {noticeLabels[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="notice-status">Estado</Label>
          <NativeSelect
            id="notice-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
            }}
          >
            <NativeSelectOption value="open">Abiertos</NativeSelectOption>
            <NativeSelectOption value="resolved">Resueltos</NativeSelectOption>
            <NativeSelectOption value="">Todos</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="notice-site">Predio</Label>
          <NativeSelect
            id="notice-site"
            value={siteId}
            disabled={sites.isPending || sites.isError}
            onChange={(e) => {
              setSiteId(e.target.value);
            }}
          >
            <NativeSelectOption value="">Todos los predios</NativeSelectOption>
            {sites.data?.map((site) => (
              <NativeSelectOption key={site.id} value={site.id}>
                {site.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      {sites.isError && (
        <Alert variant="destructive">
          No pudimos cargar los predios.{' '}
          <Button variant="outline" size="sm" onClick={() => void sites.refetch()}>
            Reintentar
          </Button>
        </Alert>
      )}
      {notices.isPending ? (
        <div role="status" className="space-y-2">
          <span className="sr-only">Cargando avisos…</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : notices.isError ? (
        <Alert variant="destructive">
          No pudimos cargar los avisos.{' '}
          <Button variant="outline" size="sm" onClick={() => void notices.refetch()}>
            Reintentar
          </Button>
        </Alert>
      ) : notices.data.items.length === 0 ? (
        <EmptyState title="No hay avisos para estos filtros" />
      ) : (
        <ul aria-label="Avisos" className="space-y-3">
          {notices.data.items.map((notice) => (
            <li key={notice.id}>
              <NoticeRow notice={notice} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

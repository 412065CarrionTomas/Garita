import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { noticeSchema } from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { NoticeRow } from './notice-row';

export function NoticeDetailPage() {
  const { id } = useParams();
  const notice = useQuery({
    queryKey: ['avisos', 'detail', id],
    queryFn: () => apiGet(`/avisos/${encodeURIComponent(id ?? '')}`, noticeSchema),
    enabled: Boolean(id),
  });
  return (
    <section className="space-y-6" aria-labelledby="notice-detail-title">
      <Button asChild variant="outline">
        <Link to="/avisos">Volver a avisos</Link>
      </Button>
      <PageHeader id="notice-detail-title" title="Detalle del aviso" />
      {notice.isPending ? (
        <p role="status">Cargando aviso…</p>
      ) : notice.isError ? (
        <Alert role="alert">
          No pudimos cargar el aviso.{' '}
          <Button variant="outline" onClick={() => void notice.refetch()}>
            Reintentar
          </Button>
        </Alert>
      ) : (
        <NoticeRow notice={notice.data} initiallyOpen />
      )}
    </section>
  );
}

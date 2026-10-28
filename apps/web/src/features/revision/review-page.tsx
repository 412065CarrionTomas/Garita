/* eslint react-refresh/only-export-components: off */
import { useState } from 'react';
import type { SyntheticEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { AlertTriangleIcon } from 'lucide-react';
import { z } from 'zod';
import { apiGet, apiPost } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const severitySchema = z.enum(['grave', 'media', 'leve']).nullable();
const rowSchema = z.object({
  id: z.string(),
  status: z.string(),
  severityLevel: severitySchema,
  startsAt: z.string(),
  endsAt: z.string(),
  windowIndex: z.number(),
  recordedCount: z.number(),
  expectedCount: z.number(),
  overdue: z.boolean(),
  shift: z.object({ id: z.string(), site: z.object({ id: z.string(), name: z.string() }) }),
  round: z.object({ name: z.string() }),
});
const queueSchema = z.object({ count: z.number(), items: z.array(rowSchema) });
const detailSchema = z.object({
  id: z.string(),
  shiftId: z.string(),
  siteId: z.string(),
  siteName: z.string(),
  roundName: z.string(),
  status: z.string(),
  severityLevel: severitySchema,
  startsAt: z.string(),
  endsAt: z.string(),
  recordedCount: z.number(),
  expectedCount: z.number(),
  records: z.array(
    z.object({
      id: z.string(),
      checkpointName: z.string(),
      occurredAtDevice: z.string(),
      invalidated: z.boolean(),
      flags: z.array(
        z.object({ type: z.string(), severity: z.string(), reason: z.string().nullable() }),
      ),
    }),
  ),
  decisions: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['validate', 'invalidate', 'restore']),
      checkpointRecordId: z.string().nullable(),
      comment: z.string(),
      decidedAt: z.string(),
      decidedBy: z.string(),
    }),
  ),
});
const commentSchema = z.object({ comment: z.string().trim().min(5).max(500) });

export function useReviewCount(enabled: boolean) {
  return useQuery({
    queryKey: ['revision', 'queue'],
    queryFn: () => apiGet('/ventanas-ronda/en-revision', queueSchema),
    enabled,
    refetchInterval: 30_000,
  });
}

function Severity({ level }: { level: z.infer<typeof severitySchema> }) {
  if (!level) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <AlertTriangleIcon aria-hidden="true" className="size-4" />
      <StatusBadge tone={level === 'grave' ? 'danger' : level === 'media' ? 'warning' : 'info'}>
        {`Gravedad ${level}`}
      </StatusBadge>
    </span>
  );
}

export function ReviewPage() {
  const { data, isPending, isError, refetch } = useReviewCount(true);
  return (
    <section className="space-y-6" aria-labelledby="review-title">
      <PageHeader
        id="review-title"
        title="Rondas en revisión"
        description="Ventanas que necesitan una decisión del supervisor."
      />
      {isPending && <p role="status">Cargando rondas…</p>}
      {isError && (
        <Alert role="alert">
          No pudimos cargar las rondas.{' '}
          <Button variant="outline" onClick={() => void refetch()}>
            Reintentar
          </Button>
        </Alert>
      )}
      {data && (
        <p aria-live="polite">
          {data.count} {data.count === 1 ? 'ventana pendiente' : 'ventanas pendientes'}
        </p>
      )}
      {data?.count === 0 && <EmptyState title="No hay rondas en revisión" />}
      <ul className="space-y-3">
        {data?.items.map((item) => (
          <li key={item.id}>
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="space-y-2">
                  <p className="font-medium">
                    {item.round.name} · {item.shift.site.name} · ventana {item.windowIndex + 1}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Desde {new Date(item.startsAt).toLocaleString('es-AR')} · {item.recordedCount}{' '}
                    de {item.expectedCount} puntos
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Severity level={item.severityLevel} />
                    {item.overdue && (
                      <StatusBadge tone="warning">Más de 24 h pendiente</StatusBadge>
                    )}
                  </div>
                </div>
                <Button asChild variant="outline">
                  <Link to={`/revision/${item.id}`}>Ver detalle</Link>
                </Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ReviewDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<{ path: string; title: string } | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['revision', id],
    queryFn: () => apiGet(`/ventanas-ronda/${encodeURIComponent(id ?? '')}`, detailSchema),
    enabled: Boolean(id),
  });
  const mutation = useMutation({
    mutationFn: (path: string) => apiPost(path, { comment }, commentSchema, detailSchema),
    onSuccess: async () => {
      setAction(null);
      setComment('');
      setError('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['revision'] }),
        queryClient.invalidateQueries({ queryKey: ['supervision'] }),
      ]);
    },
    onError: () => {
      setError('No pudimos guardar la decisión. Intentá de nuevo.');
    },
  });
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = commentSchema.safeParse({ comment });
    if (!parsed.success) {
      setError('Escribí entre 5 y 500 caracteres.');
      return;
    }
    if (action) mutation.mutate(action.path);
  };
  return (
    <section className="space-y-6" aria-labelledby="review-detail-title">
      <Link
        to="/revision"
        className="text-sm text-primary underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        ← Volver a rondas en revisión
      </Link>
      {isPending && <p role="status">Cargando ventana…</p>}
      {isError && (
        <Alert role="alert">
          No pudimos cargar la ventana.{' '}
          <Button variant="outline" onClick={() => void refetch()}>
            Reintentar
          </Button>
        </Alert>
      )}
      {data && (
        <>
          <PageHeader
            id="review-detail-title"
            title={`${data.roundName} · ${data.siteName}`}
            description={`${data.recordedCount} de ${data.expectedCount} puntos registrados`}
            actions={<Severity level={data.severityLevel} />}
          />
          <Card>
            <CardContent className="space-y-4 py-4">
              <p>
                Estado:{' '}
                {data.status === 'in_review'
                  ? 'En revisión'
                  : data.status === 'not_done'
                    ? 'No realizada'
                    : data.status === 'incomplete'
                      ? 'Incompleta'
                      : 'Completa'}
              </p>
              {data.status === 'in_review' && (
                <Button
                  onClick={() => {
                    setAction({
                      path: `/ventanas-ronda/${data.id}/validar`,
                      title: 'Validar ventana',
                    });
                  }}
                >
                  Validar ventana
                </Button>
              )}
              <h2 className="font-semibold">Registros</h2>
              <ul className="space-y-3">
                {data.records.map((record) => (
                  <li key={record.id} className="border-b border-border pb-3">
                    <p>
                      {record.checkpointName} ·{' '}
                      {new Date(record.occurredAtDevice).toLocaleString('es-AR')} ·{' '}
                      {record.invalidated ? 'Invalidado' : 'Válido'}
                    </p>
                    {record.flags.map((flag) => (
                      <p key={flag.type} className="text-sm">
                        ⚠ {flag.severity}: {flag.reason ?? flag.type}
                      </p>
                    ))}
                    <Button
                      variant="outline"
                      onClick={() => {
                        setAction({
                          path: `/registros-puntos/${record.id}/${record.invalidated ? 'restituir' : 'invalidar'}`,
                          title: record.invalidated ? 'Restituir registro' : 'Invalidar registro',
                        });
                      }}
                    >
                      {record.invalidated ? 'Restituir' : 'Invalidar'}
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 py-4">
              <h2 className="font-semibold">Historial de decisiones</h2>
              {data.decisions.length === 0 && <p>Sin decisiones todavía.</p>}
              <ol className="space-y-2">
                {data.decisions.map((decision) => (
                  <li key={decision.id}>
                    {decision.kind === 'validate'
                      ? 'Validó'
                      : decision.kind === 'invalidate'
                        ? 'Invalidó'
                        : 'Restituyó'}{' '}
                    · {decision.decidedBy} · {new Date(decision.decidedAt).toLocaleString('es-AR')}{' '}
                    · {decision.comment}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </>
      )}
      <Dialog
        open={Boolean(action)}
        onOpenChange={(open) => {
          if (!open) {
            setAction(null);
            setError('');
          }
        }}
      >
        <DialogContent>
          <DialogTitle>{action?.title}</DialogTitle>
          <DialogDescription>
            Explicá el motivo de la decisión. Quedará en el historial.
          </DialogDescription>
          <form onSubmit={submit} className="space-y-4">
            <Label htmlFor="review-comment">Comentario o motivo</Label>
            <Textarea
              id="review-comment"
              value={comment}
              onChange={(event) => {
                setComment(event.target.value);
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'review-comment-error' : undefined}
              minLength={5}
              maxLength={500}
              required
            />
            {error && (
              <p id="review-comment-error" className="text-sm text-danger" role="alert">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setAction(null);
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {action?.title}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

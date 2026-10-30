import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { noticeSchema } from '@garita/shared';
import { z } from 'zod';
import { apiPost } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { NoticeActions } from './notice-actions';
import { noticeLabels, resolutionLabels } from './labels';

const detailsSchema = z.object({
  missingPoints: z.array(z.string()).optional(),
  severityLevel: z.enum(['grave', 'media', 'leve']).nullable().optional(),
  occurredAt: z.iso.datetime().optional(),
  closedAt: z.iso.datetime().optional(),
  reason: z.string().optional(),
});
const date = (value: string) => new Date(value).toLocaleString('es-AR');

export function NoticeRow({
  notice,
  initiallyOpen = false,
}: {
  notice: z.infer<typeof noticeSchema>;
  initiallyOpen?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyOpen);
  const client = useQueryClient();
  const seen = useMutation({
    mutationFn: () =>
      apiPost(
        `/avisos/${encodeURIComponent(notice.id)}/marcar-visto`,
        {},
        z.object({}),
        noticeSchema,
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ['avisos'] }),
  });
  const markSeen = seen.mutate;
  useEffect(() => {
    if (initiallyOpen && !notice.seenAt) markSeen();
  }, [initiallyOpen, notice.seenAt, markSeen]);
  const parsed = detailsSchema.safeParse(notice.details);
  const details = parsed.success ? parsed.data : null;
  const occurredAt = details?.occurredAt ?? details?.closedAt ?? notice.createdAt;
  return (
    <Card className={!notice.seenAt ? 'border-warning' : undefined}>
      <CardContent className="space-y-3">
        <h2 className="font-semibold">
          {noticeLabels[notice.kind]} en {notice.site.name}
        </h2>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={notice.status === 'open' ? 'warning' : 'success'}>
            {notice.status === 'open' ? 'Abierto' : 'Resuelto'}
          </StatusBadge>
          <StatusBadge tone={notice.seenAt ? 'neutral' : 'info'}>
            {notice.seenAt ? 'Visto' : 'No visto'}
          </StatusBadge>
        </div>
        <p className="text-sm tabular-nums">
          Turno: {date(notice.shift.startsAt)} – {date(notice.shift.endsAt)}
        </p>
        {details?.missingPoints && (
          <p className="text-sm">
            Puntos faltantes: {details.missingPoints.join(', ') || 'Ninguno'}
          </p>
        )}
        <p className="text-sm tabular-nums">
          Evento: {date(occurredAt)}
          {Date.parse(occurredAt) !== Date.parse(notice.createdAt) &&
            ` · Recibido: ${date(notice.createdAt)}`}
        </p>
        {notice.status === 'resolved' && (
          <p className="text-sm">
            Resolución:{' '}
            {notice.resolution ? resolutionLabels[notice.resolution] : 'Sin motivo registrado'}
            {notice.resolvedAt && ` · ${date(notice.resolvedAt)}`}
          </p>
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-controls={`notice-${notice.id}`}
          onClick={() => {
            if (!expanded && !notice.seenAt) seen.mutate();
            setExpanded(!expanded);
          }}
        >
          {expanded ? 'Ocultar aviso' : 'Abrir aviso'}
        </Button>
        {seen.isError && (
          <Alert role="alert">
            No pudimos marcar el aviso como visto.{' '}
            <Button
              variant="outline"
              onClick={() => {
                seen.mutate();
              }}
            >
              Reintentar
            </Button>
          </Alert>
        )}
        {expanded && (
          <div id={`notice-${notice.id}`} className="space-y-3">
            {details?.severityLevel && <p>Gravedad: {details.severityLevel}</p>}
            {details?.reason && <p>Motivo: {details.reason}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild variant="outline">
                <Link to={`/supervision/turnos/${encodeURIComponent(notice.shiftId)}`}>
                  Ver turno
                </Link>
              </Button>
              <NoticeActions notice={notice} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

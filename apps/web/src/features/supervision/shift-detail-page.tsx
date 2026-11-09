import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { apiGet } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { PointPath } from '@/components/point-path';
import { PointTable } from '@/components/point-table';
import { StatusBadge } from '@/components/status-badge';
import { WindowBar } from '@/components/window-bar';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  foja,
  isCompleteWindow,
  shiftDetailSchema,
  shiftLabels,
  shiftTones,
  time,
  windowBoxStatus,
} from './contracts';
import type { Severity, ShiftDetail } from './contracts';
import {
  AssignmentsSection,
  CoverageSection,
  RecordsSection,
  RejectedSection,
  RouteSection,
  WindowsSection,
} from './detail-sections';
import { useOpenNotices } from '../avisos/queries';
import { CloseWithoutDataDialog } from '../avisos/close-without-data-dialog';
import { LiveMap } from '../mapa/live-map';
import { LiveLayout } from './live-layout';
import { ReassignDialog } from './reassign-dialog';
import { useSiteCoordinates } from './use-site-coordinates';

const BACK = (
  <Link
    to="/supervision"
    className="inline-flex min-h-9 items-center px-1 text-sm font-semibold underline underline-offset-4"
  >
    ← Rondas
  </Link>
);

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="t-label text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

function Foja({ detail, noticePending }: { detail: ShiftDetail; noticePending: boolean }) {
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [severity, setSeverity] = useState<'' | Severity>('');
  const [reassignOpen, setReassignOpen] = useState(false);
  const [closeWithoutDataOpen, setCloseWithoutDataOpen] = useState(false);
  const coordinates = useSiteCoordinates();
  const { path, rows, done } = useMemo(() => foja(detail), [detail]);
  const windows = [...detail.windows].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const completeWindows = windows.filter((w) => isCompleteWindow(w.status)).length;
  const currentWindow =
    windows.find((w) => w.status === 'in_progress' || w.status === 'late') ??
    windows.find((w) => w.status === 'pending');
  const guard = detail.assignments.find((a) => a.isCurrent)?.guard;
  const roundName = detail.rounds[0]?.name;

  const siteAt = coordinates.get(detail.site.id);
  const mapPoints = detail.points.map((point, index) => ({
    id: point.id,
    name: point.name,
    lat: point.latitude,
    lng: point.longitude,
    status: path[index]?.status ?? ('pending' as const),
  }));

  const panel = (
    <>
      <div className="flex items-center gap-3.5 border-b border-border px-5 py-2">
        {BACK}
        <p className="t-label ml-auto text-muted-foreground">
          Foja de ronda{roundName ? ` ${roundName}` : ''} · turno {time(detail.scheduled.startsAt)}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-5 pt-4">
          <PageHeader
            id="detail-title"
            title={detail.site.name}
            actions={
              <StatusBadge tone={shiftTones[detail.status]}>
                {shiftLabels[detail.status]}
              </StatusBadge>
            }
          />
        </div>
        {/* TODO(foja): "Última sincronización" no viene en el detalle (sí en la lista, como syncStatus). */}
        <dl className="flex flex-wrap gap-x-6 gap-y-1 px-5 pt-3 pb-3.5">
          <Meta label="Vigilador">
            {guard ? `${guard.firstName} ${guard.lastName}` : 'Sin vigilador'}
          </Meta>
          <Meta label="Ventana actual">
            {currentWindow
              ? `${time(currentWindow.startsAt)}–${time(currentWindow.endsAt)}`
              : 'Sin ventana en curso'}
          </Meta>
          <Meta label="Puntos">
            {done} de {detail.points.length}
          </Meta>
        </dl>
        <div className="px-5 pb-1.5">
          <PointPath points={path} selectedId={selectedPointId} onSelect={setSelectedPointId} />
        </div>
        <div className="flex items-center gap-3.5 px-5 pb-3 text-sm text-muted-foreground">
          <WindowBar windows={windows.map((w) => ({ status: windowBoxStatus[w.status] }))} />
          <span>
            {completeWindows} de {windows.length} ventanas completas
          </span>
        </div>
        {(noticePending || detail.canCover) && (
          <div className="flex flex-wrap gap-2 border-t border-border px-5 py-2.5">
            {noticePending && (
              <Button
                variant="outline"
                onClick={() => {
                  setCloseWithoutDataOpen(true);
                }}
              >
                Cerrar sin datos
              </Button>
            )}
            {detail.canCover && (
              <Button
                onClick={() => {
                  setReassignOpen(true);
                }}
              >
                {detail.status === 'uncovered' ? 'Cubrir el resto' : 'Reasignar'}
              </Button>
            )}
          </div>
        )}
        {/* TODO(foja): "Llamar" / "Enviar SMS" necesita el teléfono del vigilador, que el detalle no trae. */}
        <div className="flex h-96 flex-col px-5">
          <PointTable rows={rows} selectedId={selectedPointId} onSelect={setSelectedPointId} />
        </div>
        <div className="space-y-6 px-5 py-6">
          <CoverageSection detail={detail} />
          <AssignmentsSection detail={detail} />
          <WindowsSection detail={detail} />
          <RouteSection detail={detail} />
          <RecordsSection
            detail={detail}
            flaggedOnly={flaggedOnly}
            severity={severity}
            onFlaggedOnly={setFlaggedOnly}
            onSeverity={setSeverity}
          />
          <RejectedSection detail={detail} />
        </div>
      </div>
      {closeWithoutDataOpen && (
        <CloseWithoutDataDialog
          shiftId={detail.id}
          onClose={() => {
            setCloseWithoutDataOpen(false);
          }}
        />
      )}
      {reassignOpen && (
        <ReassignDialog
          shiftId={detail.id}
          endsAt={detail.scheduled.endsAt}
          minutesToSignal={
            detail.site.connectivityType === 'without_signal' ? detail.site.minutesToSignal : null
          }
          covering={detail.status === 'uncovered'}
          open={reassignOpen}
          onOpenChange={setReassignOpen}
        />
      )}
    </>
  );

  return (
    <LiveLayout
      labelledBy="detail-title"
      panel={panel}
      map={
        <LiveMap
          sites={
            siteAt
              ? [
                  {
                    id: detail.site.id,
                    name: detail.site.name,
                    ...siteAt,
                    label: `${done}/${detail.points.length}`,
                    description: `${done} de ${detail.points.length} puntos registrados`,
                    state: 'normal',
                  },
                ]
              : []
          }
          selectedSiteId={detail.site.id}
          points={mapPoints}
          selectedPointId={selectedPointId}
          onSelectPoint={setSelectedPointId}
        />
      }
    />
  );
}

export function ShiftDetailPage() {
  const { id } = useParams();
  const notices = useOpenNotices(Boolean(id));
  const {
    data: detail,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['supervision', 'detalle', id],
    queryFn: () => apiGet(`/turnos/${encodeURIComponent(id ?? '')}/detalle`, shiftDetailSchema),
    enabled: Boolean(id),
  });
  if (isPending || isError)
    return (
      <LiveLayout
        labelledBy="detail-title"
        map={<LiveMap sites={[]} />}
        panel={
          <>
            <div className="border-b border-border px-5 py-2">{BACK}</div>
            {isError ? (
              <Alert variant="destructive" role="alert" className="m-5 w-auto">
                No pudimos cargar el turno.{' '}
                <button
                  type="button"
                  className="font-semibold underline"
                  onClick={() => void refetch()}
                >
                  Reintentar
                </button>
              </Alert>
            ) : (
              <div role="status" aria-label="Cargando detalle" className="space-y-3 p-5">
                <h1 id="detail-title" className="sr-only">
                  Cargando detalle
                </h1>
                <Skeleton className="h-9 w-2/3" />
                <Skeleton className="h-40" />
                <Skeleton className="h-64" />
              </div>
            )}
          </>
        }
      />
    );
  return (
    <Foja
      detail={detail}
      noticePending={(notices.data?.items ?? []).some(
        (notice) =>
          notice.shiftId === detail.id &&
          notice.kind === 'shift_unsynced' &&
          notice.status === 'open',
      )}
    />
  );
}

import {
  INCIDENT_CLASSIFICATION_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_TYPE_LABELS,
  incidentQueueResponseSchema,
} from '@garita/shared';
import { useQuery } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/empty-state';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiGet } from '@/lib/api-client';
import { useFillHeight } from '@/lib/use-fill-height';
import { cn } from '@/lib/utils';
import { DecisionForm } from './decision-form';
import { IncidentBody, useIncidentDetail } from './incident-detail';
import { RowsSkeleton, ageText, fullDateTime, shortcutsBlocked } from './incident-ui';

function SelectedIncident({
  id,
  onDone,
  onConflict,
}: {
  id: string;
  onDone: (text: string) => void;
  onConflict: () => void;
}) {
  const detail = useIncidentDetail(id);
  // El formulario se abre a pedido: mientras tanto la ficha usa todo el alto.
  const [deciding, setDeciding] = useState(false);
  // Al abrir, el foco va a la primera opción; al ocultar, vuelve al botón que lo abrió.
  const openButton = useRef<HTMLButtonElement>(null);
  const decision = useRef<HTMLElement>(null);
  const toggled = useRef(false);
  useEffect(() => {
    if (!toggled.current) return;
    if (deciding) decision.current?.querySelector<HTMLElement>('input')?.focus();
    else openButton.current?.focus();
  }, [deciding]);
  const toggle = (open: boolean) => {
    toggled.current = true;
    setDeciding(open);
  };
  if (detail.isPending)
    return (
      <div className="p-5">
        <RowsSkeleton label="Cargando incidente…" rows={4} />
      </div>
    );
  if (detail.isError)
    return (
      <Alert variant="destructive" className="m-5">
        No se pudo cargar el incidente.{' '}
        <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>
          Reintentar
        </Button>
      </Alert>
    );
  const incident = detail.data;
  const title = INCIDENT_TYPE_LABELS[incident.type];
  return (
    // La ficha scrollea; la decisión queda fija al pie, sin taparla.
    <article aria-labelledby={`triage-${id}`} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="space-y-1">
            <h2 id={`triage-${id}`} className="t-headline">
              {title}
            </h2>
            <p className="text-muted-foreground">
              {incident.site.name} · {fullDateTime(incident.occurredAt, incident.timezone)} ·{' '}
              {incident.guardName}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to={`/incidentes/${id}`}>Abrir ficha completa</Link>
            </Button>
            {!deciding && (
              <Button
                ref={openButton}
                onClick={() => {
                  toggle(true);
                }}
              >
                Clasificar
              </Button>
            )}
          </div>
        </header>
        <IncidentBody incident={incident} compact />
      </div>
      {deciding && (
        <section
          ref={decision}
          aria-labelledby={`triage-decision-${id}`}
          className="max-h-[60%] shrink-0 space-y-3 overflow-y-auto border-t-[1.5px] border-input bg-card px-5 py-4"
        >
          <div className="flex items-center justify-between gap-3">
            <h3
              id={`triage-decision-${id}`}
              className="font-cond text-lg font-semibold tracking-wider uppercase"
            >
              Clasificar
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                toggle(false);
              }}
            >
              Ocultar
            </Button>
          </div>
          <DecisionForm
            id={id}
            reclassify={false}
            submitLabel="Confirmar y seguir"
            onDone={({ classification, severity }) => {
              onDone(
                `${title} (${incident.site.name}): ${INCIDENT_CLASSIFICATION_LABELS[classification].toLowerCase()}, gravedad ${INCIDENT_SEVERITY_LABELS[severity].toLowerCase()}.`,
              );
            }}
            onConflict={onConflict}
          />
        </section>
      )}
    </article>
  );
}

/** Bandeja de triage: pendientes del más antiguo al más nuevo y la decisión al lado. */
export function TriageView() {
  const queue = useQuery({
    queryKey: ['incidents', 'queue'],
    queryFn: () => apiGet('/incidentes/cola', incidentQueueResponseSchema),
    refetchInterval: 30_000,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [measure, height] = useFillHeight<HTMLDivElement>(16, 480);
  const items = useMemo(() => queue.data?.items ?? [], [queue.data]);
  // Lo elegido ya no está (otro lo clasificó, o se confirmó): pasa al que ocupaba su lugar.
  const [lastIndex, setLastIndex] = useState(0);
  const index = items.findIndex((item) => item.id === selectedId);
  const fallback = items.at(Math.min(lastIndex, items.length - 1));
  if (fallback && index === -1) setSelectedId(fallback.id);
  else if (index !== -1 && index !== lastIndex) setLastIndex(index);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (shortcutsBlocked(event) || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
      const current = items.findIndex((item) => item.id === selectedId);
      const next = items[current + (event.key === 'ArrowDown' ? 1 : -1)];
      if (!next) return;
      event.preventDefault();
      setSelectedId(next.id);
      document.getElementById(`triage-item-${next.id}`)?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [items, selectedId]);

  if (queue.isPending) return <RowsSkeleton label="Cargando incidentes por clasificar…" />;
  if (queue.isError)
    return (
      <Alert variant="destructive">
        No se pudo cargar la bandeja.{' '}
        <Button variant="outline" size="sm" onClick={() => void queue.refetch()}>
          Reintentar
        </Button>
      </Alert>
    );
  const overdue = items.filter((item) => item.overdue).length;
  return (
    <div className="space-y-3">
      <p role="status" aria-live="polite" className={cn('text-base', !message && 'sr-only')}>
        {message && <>Listo: {message}</>}
      </p>
      {!items.length ? (
        <EmptyState
          title="No hay incidentes por clasificar"
          description="Cuando un vigilador reporte uno, aparece acá para decidir quién lo ve."
          action={
            <Button asChild variant="outline">
              <Link to="/incidentes?vista=todos">Ver todos los incidentes</Link>
            </Button>
          }
        />
      ) : (
        <div
          ref={measure}
          style={{ '--fill': `${String(height ?? 480)}px` } as CSSProperties}
          // Alto fijo solo en dos columnas; en pantallas angostas fluye y scrollea la página.
          className="grid min-h-0 gap-0 border-[1.5px] border-input lg:h-(--fill) lg:grid-cols-[minmax(0,2fr)_minmax(0,5fr)]"
        >
          <div className="flex min-h-0 flex-col border-b-[1.5px] border-input lg:border-r-[1.5px] lg:border-b-0">
            <p className="border-b border-border px-4 py-2.5 text-sm text-muted-foreground">
              {items.length} pendientes
              {overdue > 0 && (
                <>
                  {' · '}
                  <span className="font-semibold text-warning">{overdue} con más de 24 h</span>
                </>
              )}
            </p>
            <ul aria-label="Incidentes por clasificar" className="min-h-0 flex-1 overflow-y-auto">
              {items.map((item) => {
                const selected = item.id === selectedId;
                return (
                  <li key={item.id} id={`triage-item-${item.id}`}>
                    <button
                      type="button"
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => {
                        setSelectedId(item.id);
                      }}
                      className={cn(
                        'grid w-full grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-b border-border px-4 py-3 text-left hover:bg-muted',
                        selected && 'bg-muted ring-2 ring-primary ring-inset',
                      )}
                    >
                      <span className="truncate font-semibold">
                        {INCIDENT_TYPE_LABELS[item.type]}
                      </span>
                      <span
                        className={cn(
                          'text-right font-semibold tabular-nums',
                          item.overdue ? 'text-warning' : 'text-muted-foreground',
                        )}
                      >
                        {ageText(item.ageMs)}
                        {item.overdue && <span className="sr-only"> (más de 24 h)</span>}
                      </span>
                      <span className="truncate text-sm text-muted-foreground">
                        {item.site.name} · {item.guardName}
                      </span>
                      {item.photoCount > 0 && (
                        <span className="flex items-center justify-end gap-1 text-sm text-muted-foreground">
                          <Camera aria-hidden="true" className="size-4" />
                          {item.photoCount}
                          <span className="sr-only"> fotos</span>
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="flex min-h-0 flex-col">
            {selectedId && (
              <SelectedIncident
                key={selectedId}
                id={selectedId}
                onDone={(text) => {
                  setMessage(text);
                }}
                onConflict={() => {
                  setMessage('otra persona ya lo había clasificado; pasamos al siguiente.');
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

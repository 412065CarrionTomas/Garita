import { Link } from 'react-router';
import { Stamp, type StampVariant } from '@/components/stamp';
import { useOpenNotices } from '@/features/avisos/queries';
import { useActivePanicAlerts } from '@/features/panico/queries';
import { cn } from '@/lib/utils';
import { useCompanyPending } from '../queries';
import { WidgetFrame } from '../widget-frame';
import type { WidgetProps } from './widget-props';

interface AttentionRow {
  key: string;
  label: string;
  /** null mientras carga o si falló: se muestra sin cifra, nunca como "cero". */
  count: number | null;
  variant: StampVariant;
  detail: string;
  to: string;
  action: string;
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

function useAttentionRows(): AttentionRow[] {
  const panic = useActivePanicAlerts(true);
  const notices = useOpenNotices(true);
  const pending = useCompanyPending();
  const p = pending.data;
  const unknown = (failed: boolean) => (failed ? 'No disponible' : 'Cargando…');
  // Lo pendiente lleva su tono; en cero, tinta con tilde (lo normal sin color).
  const variantFor = (count: number | null, active: StampVariant): StampVariant =>
    count ? active : 'normal';
  const firstPanic = panic.data?.items[0];
  const rows: AttentionRow[] = [
    {
      key: 'panic',
      label: 'Alertas de pánico',
      count: panic.data?.activeCount ?? null,
      variant: variantFor(panic.data?.activeCount ?? null, 'fail'),
      detail: firstPanic
        ? `${firstPanic.site.name} · desde ${clock(firstPanic.triggeredAt)}`
        : panic.data
          ? 'Ninguna activa'
          : unknown(panic.isError),
      to: '/alertas-panico',
      action: 'Atender',
    },
    {
      key: 'unassigned',
      label: 'Turnos sin vigilador',
      count: p?.unassigned.count ?? null,
      variant: variantFor(p?.unassigned.count ?? null, 'fail'),
      detail: p
        ? p.unassigned.nextAt
          ? `El próximo empieza ${clock(p.unassigned.nextAt)}`
          : 'Todos cubiertos'
        : unknown(pending.isError),
      to: '/turnos?vista=lista&estado=problema',
      action: 'Cubrir',
    },
    {
      key: 'review',
      label: 'Rondas en revisión',
      count: p?.inReview.count ?? null,
      variant: variantFor(p?.inReview.count ?? null, 'late'),
      detail: p
        ? p.inReview.oldestAt
          ? `La más antigua desde ${clock(p.inReview.oldestAt)}`
          : 'Ninguna pendiente'
        : unknown(pending.isError),
      to: '/revision',
      action: 'Revisar',
    },
    {
      key: 'incidents',
      label: 'Incidentes por clasificar',
      count: p?.incidents.count ?? null,
      variant: variantFor(p?.incidents.count ?? null, 'late'),
      detail: p
        ? p.incidents.oldestAt
          ? `El más antiguo desde ${clock(p.incidents.oldestAt)}`
          : 'Ninguno pendiente'
        : unknown(pending.isError),
      to: '/incidentes?vista=por-clasificar',
      action: 'Clasificar',
    },
    {
      key: 'unsynced',
      label: 'Ventanas sin sincronizar',
      count: p?.unsynced.count ?? null,
      variant: variantFor(p?.unsynced.count ?? null, 'dashed'),
      detail: p
        ? p.unsynced.oldestAt
          ? `Esperando desde ${clock(p.unsynced.oldestAt)}`
          : 'Todo sincronizado'
        : unknown(pending.isError),
      to: '/supervision',
      action: 'Ver',
    },
    {
      key: 'notices',
      label: 'Avisos abiertos',
      count: notices.data?.openCount ?? null,
      variant: variantFor(notices.data?.openCount ?? null, 'dashed'),
      detail: notices.data
        ? notices.data.openCount
          ? `${notices.data.unseenOpenCount} sin ver`
          : 'Ninguno abierto'
        : unknown(notices.isError),
      to: '/avisos',
      action: 'Avisos',
    },
  ];
  return rows;
}

function CountStamp({ row }: { row: AttentionRow }) {
  if (row.count === null) return <Stamp variant="dashed">—</Stamp>;
  return (
    <Stamp variant={row.variant} check={row.count === 0}>
      {row.count === 0 ? 'Sin pendientes' : row.count}
    </Stamp>
  );
}

/** Lo que pide una acción ahora: no depende del período. Tabla (A) o columna en tinta (B). */
export function AttentionWidget({ item }: WidgetProps) {
  const rows = useAttentionRows();
  if (item.presentation === 'column')
    return (
      <WidgetFrame title="Atención ahora" inverted>
        <ul className="divide-y divide-bar-muted/30 px-5">
          {rows.map((row) => (
            <li key={row.key} className="flex items-start gap-3 py-3">
              <span
                // Sobre la barra en tinta, como los contadores de la navegación: relleno pleno
                // en rojo o ámbar (contraste en claro y oscuro) y la forma también distingue.
                className={cn(
                  't-numeral min-w-11 border-[1.5px] px-1.5 text-center text-2xl',
                  row.variant === 'fail' &&
                    'border-double border-[3px] border-danger-foreground bg-danger text-danger-foreground',
                  row.variant === 'late' && 'border-warning bg-warning text-warning-foreground',
                  row.variant === 'dashed' && 'border-dashed border-bar-muted text-bar-muted',
                  row.variant === 'normal' && 'border-bar-foreground',
                )}
                aria-hidden="true"
              >
                {row.count ?? '—'}
              </span>
              <span className="min-w-0 flex-1">
                <Link
                  to={row.to}
                  aria-label={`${row.label}: ${row.count ?? 'sin dato'}`}
                  title={row.label}
                  className="block truncate font-semibold underline-offset-4 hover:underline"
                >
                  {row.label}
                </Link>
                <span title={row.detail} className="block truncate text-sm text-bar-muted">
                  {row.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </WidgetFrame>
    );
  return (
    <WidgetFrame
      title="Atención ahora"
      aside={<span className="t-label text-muted-foreground">Ahora</span>}
    >
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li
            key={row.key}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 @2xl:grid-cols-[minmax(0,14rem)_minmax(0,9rem)_minmax(0,1fr)_auto]"
          >
            <span title={row.label} className="truncate font-semibold">
              {row.label}
            </span>
            <span className="justify-self-end @2xl:justify-self-start">
              <CountStamp row={row} />
            </span>
            <span title={row.detail} className="truncate text-sm text-muted-foreground">
              {row.detail}
            </span>
            <Link
              to={row.to}
              aria-label={`${row.action}: ${row.label}`}
              className="justify-self-end text-sm font-semibold whitespace-nowrap underline-offset-4 hover:underline"
            >
              {row.action} →
            </Link>
          </li>
        ))}
      </ul>
    </WidgetFrame>
  );
}

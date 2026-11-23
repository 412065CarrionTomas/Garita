import { useState } from 'react';
import { Pin } from 'lucide-react';
import { adminSummaryCatalog, MAX_FAVORITES, type ComplianceReport } from '@garita/shared';
import { Stamp } from '@/components/stamp';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useFavorites, type FavoritesState } from '@/features/favoritos/use-favorites';
import { COMPLIANCE_THRESHOLD } from '@/features/reportes/charts/compliance-tone';
import { ComplianceBar } from '@/features/reportes/compliance-views';
import { useAnnouncer } from '@/lib/interaction/use-announcer';
import {
  applyOrder,
  availableActions,
  mergeVisibleOrder,
  moveId,
  partitionPinned,
  pin,
  unpin,
  type ReorderAction,
} from '@/lib/sortable-list/reorder';
import { RowMenu, type RowActionGroup } from '@/lib/sortable-list/row-menu';
import { useSortableDrag, type SortableDrag } from '@/lib/sortable-list/use-sortable-drag';
import { cn } from '@/lib/utils';
import { useComplianceReport } from '../queries';
import { sortSites } from '../summary-rows';
import { WidgetEmpty, WidgetFrame, WidgetStatus } from '../widget-frame';
import type { WidgetProps } from './widget-props';

type Site = ComplianceReport['bySite'][number];
const siteId = (site: Site) => site.id;

const MOVE_LABELS: Record<ReorderAction, string> = {
  top: 'Mover al principio',
  up: 'Subir un lugar',
  down: 'Bajar un lugar',
  bottom: 'Mover al final',
};

function SiteRow({
  site,
  pinned,
  drag,
  groups,
}: {
  site: Site;
  pinned: boolean;
  drag: SortableDrag;
  groups: readonly RowActionGroup[];
}) {
  const value = site.totals.percentage;
  return (
    <TableRow
      data-sortable-row
      style={drag.rowStyle(site.id)}
      className={cn(
        pinned && 'bg-muted/40',
        drag.draggingId === site.id && 'bg-card outline-2 -outline-offset-2 outline-foreground',
      )}
    >
      <TableCell className="font-semibold">
        <span className="flex items-center gap-1.5">
          {pinned && <Pin aria-hidden="true" className="size-3.5 shrink-0" />}
          {site.name}
          {pinned && <span className="sr-only">(fijado)</span>}
        </span>
      </TableCell>
      <TableCell className="t-numeral text-right">{site.totals.evaluated}</TableCell>
      <TableCell className="t-numeral text-right">{site.totals.not_done}</TableCell>
      <TableCell>
        {value === null ? (
          <span className="text-muted-foreground">Sin datos</span>
        ) : (
          <span className="flex items-center gap-3">
            <ComplianceBar value={value} />
            <span className="t-numeral">
              {value.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %
            </span>
            {value < COMPLIANCE_THRESHOLD && <Stamp variant="fail">Revisar</Stamp>}
          </span>
        )}
      </TableCell>
      <TableCell className="w-12 text-right">
        <RowMenu
          label={site.name}
          groups={groups}
          drag={{
            onStart: (height) => {
              drag.start(site.id, height);
            },
            onMove: drag.move,
            onEnd: drag.end,
            onCancel: drag.cancel,
          }}
        />
      </TableCell>
    </TableRow>
  );
}

function FavoritesNotice({ favorites }: { favorites: FavoritesState }) {
  const { notice } = favorites;
  return (
    <div role="status" className="min-h-0">
      {notice && (
        <p className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-2 text-sm">
          <span className={cn(notice.failed && 'text-danger')}>{notice.message}</span>
          {!notice.failed && (
            <Button variant="outline" size="sm" onClick={favorites.undo}>
              Deshacer
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={favorites.dismiss}>
            Cerrar aviso
          </Button>
        </p>
      )}
    </div>
  );
}

/**
 * Predios del período. Los fijados (favoritos de esta pantalla) van arriba en el orden que eligió
 * el usuario y se guardan al instante; el resto sigue el orden del ajuste y se puede mover solo
 * durante esta visita. Cada fila tiene su menú ⋮; mantenerlo apretado permite arrastrarla.
 */
export function SitesWidget({ item }: WidgetProps) {
  const { sort, limit } = adminSummaryCatalog.widgets.sites.settings.parse(item.settings);
  // Comparte el informe de 30 días con el bloque de cumplimiento: un solo pedido.
  const report = useComplianceReport('30d');
  const favorites = useFavorites('admin-summary', 'site');
  const [sessionOrder, setSessionOrder] = useState<readonly string[]>([]);
  const { announce, region } = useAnnouncer('Cambios en la lista de predios');

  const sorted = sortSites(report.data?.bySite ?? [], sort, 'all');
  const { pinned, rest } = partitionPinned(sorted, favorites.ids, siteId);
  const ordered = applyOrder(rest, sessionOrder, siteId);
  const shown = limit === 'all' ? ordered : ordered.slice(0, Number(limit));
  const pinnedIds = pinned.map(siteId);
  const orderedIds = ordered.map(siteId);
  const shownIds = shown.map(siteId);
  const nameOf = (id: string) => sorted.find((site) => site.id === id)?.name ?? 'El predio';

  const savePinned = (visibleNext: readonly string[], id: string, message: string) => {
    favorites.update(mergeVisibleOrder(favorites.ids, visibleNext), `${nameOf(id)} ${message}`);
  };
  const pinnedDrag = useSortableDrag(pinnedIds, (next, id, index) => {
    savePinned(next, id, `quedó en el lugar ${index + 1} de los fijados.`);
  });
  const restDrag = useSortableDrag(shownIds, (next, id, index) => {
    setSessionOrder(mergeVisibleOrder(orderedIds, next));
    announce(`${nameOf(id)} quedó en el lugar ${index + 1} (solo en esta visita).`);
  });

  const pinnedGroups = (id: string): RowActionGroup[] => [
    {
      label: 'Fijados',
      actions: [
        ...availableActions(pinnedIds, id).map((action) => ({
          key: action,
          label: MOVE_LABELS[action],
          onSelect: () => {
            savePinned(moveId(pinnedIds, id, action), id, 'cambió de lugar entre los fijados.');
          },
        })),
        {
          key: 'unpin',
          label: 'Quitar de fijados',
          onSelect: () => {
            favorites.update(unpin(favorites.ids, id), `${nameOf(id)} ya no está fijado.`);
          },
        },
      ],
    },
  ];
  const restGroups = (id: string): RowActionGroup[] => [
    {
      label: 'Fijar en esta pantalla',
      actions: [
        {
          key: 'pin-top',
          label: favorites.full ? `Fijar arriba (máximo ${MAX_FAVORITES})` : 'Fijar arriba de todo',
          disabled: favorites.full,
          onSelect: () => {
            favorites.update(
              pin(favorites.ids, id, 'top', MAX_FAVORITES),
              `${nameOf(id)} quedó fijado arriba de todo.`,
            );
          },
        },
        {
          key: 'pin-bottom',
          label: 'Fijar al final de los fijados',
          disabled: favorites.full,
          onSelect: () => {
            favorites.update(
              pin(favorites.ids, id, 'bottom', MAX_FAVORITES),
              `${nameOf(id)} quedó fijado al final de los fijados.`,
            );
          },
        },
      ],
    },
    {
      label: 'Solo en esta visita',
      actions: availableActions(orderedIds, id)
        .filter((action) => action === 'top' || action === 'bottom')
        .map((action) => ({
          key: action,
          label: MOVE_LABELS[action],
          onSelect: () => {
            setSessionOrder(moveId(orderedIds, id, action));
            announce(
              `${nameOf(id)} ${action === 'top' ? 'pasó al principio' : 'pasó al final'} (solo en esta visita).`,
            );
          },
        })),
    },
  ];

  const title = sort === 'worst' ? 'Predios · peor cumplimiento primero' : 'Predios';
  const link = { to: '/cumplimiento', label: 'Ver todos' };
  if (!report.data)
    return (
      <WidgetFrame title={title} link={link}>
        <WidgetStatus query={report} label="los predios" />
      </WidgetFrame>
    );
  return (
    <WidgetFrame
      title={title}
      link={link}
      aside={<span className="t-label text-muted-foreground">30 días</span>}
    >
      {region}
      {sorted.length === 0 ? (
        <WidgetEmpty>Sin predios con rondas en el período.</WidgetEmpty>
      ) : (
        <Table>
          <caption className="sr-only">
            Cumplimiento por predio en los últimos 30 días; los fijados van primero.
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead>Predio</TableHead>
              <TableHead className="text-right">Ventanas</TableHead>
              <TableHead className="text-right">No realizadas</TableHead>
              <TableHead>Cumplimiento</TableHead>
              <TableHead>
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          {pinned.length > 0 && (
            <TableBody aria-label="Predios fijados" className="border-b-2 border-border">
              {pinned.map((site) => (
                <SiteRow
                  key={site.id}
                  site={site}
                  pinned
                  drag={pinnedDrag}
                  groups={pinnedGroups(site.id)}
                />
              ))}
            </TableBody>
          )}
          <TableBody>
            {shown.map((site) => (
              <SiteRow
                key={site.id}
                site={site}
                pinned={false}
                drag={restDrag}
                groups={restGroups(site.id)}
              />
            ))}
          </TableBody>
        </Table>
      )}
      <FavoritesNotice favorites={favorites} />
    </WidgetFrame>
  );
}

import { useState } from 'react';
import { Pin } from 'lucide-react';
import { MAX_FAVORITES, type ComplianceReport, type FavoriteEntityType } from '@garita/shared';
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
import { sortByCompliance } from './summary-rows';
import { WidgetEmpty, WidgetFrame, WidgetStatus } from './widget-frame';

/** Una fila del ranking. `pinnable` es false para lo que la API no deja fijar (p. ej. desactivados). */
export interface RankingRow {
  id: string;
  name: string;
  totals: ComplianceReport['totals'];
  pinnable: boolean;
}
/** Textos que dependen de lo que lista el ranking. */
export interface RankingNouns {
  /** Encabezado de la primera columna, p. ej. "Predio". */
  column: string;
  /** En plural y minúscula, p. ej. "predios". */
  plural: string;
}

const rowId = (row: RankingRow) => row.id;

const MOVE_LABELS: Record<ReorderAction, string> = {
  top: 'Mover al principio',
  up: 'Subir un lugar',
  down: 'Bajar un lugar',
  bottom: 'Mover al final',
};

function RankingRowView({
  row,
  pinned,
  drag,
  groups,
}: {
  row: RankingRow;
  pinned: boolean;
  drag: SortableDrag;
  groups: readonly RowActionGroup[];
}) {
  const value = row.totals.percentage;
  return (
    <TableRow
      data-sortable-row
      style={drag.rowStyle(row.id)}
      className={cn(
        pinned && 'bg-muted/40',
        drag.draggingId === row.id && 'bg-card outline-2 -outline-offset-2 outline-foreground',
      )}
    >
      {/* Ancho 0 y máximo 100 %: la columna del nombre cede lugar y el nombre se corta con "…". */}
      <TableCell className="w-full max-w-0 font-semibold">
        <span className="flex items-center gap-1.5">
          {pinned && <Pin aria-hidden="true" className="size-3.5 shrink-0" />}
          <span title={row.name} className="min-w-0 truncate">
            {row.name}
          </span>
          {pinned && <span className="sr-only">(fijado)</span>}
        </span>
      </TableCell>
      <TableCell className="hidden t-numeral text-right @lg:table-cell">
        {row.totals.evaluated}
      </TableCell>
      <TableCell className="hidden t-numeral text-right @lg:table-cell">
        {row.totals.not_done}
      </TableCell>
      <TableCell>
        {value === null ? (
          <span className="text-muted-foreground">Sin datos</span>
        ) : (
          <span className="flex items-center gap-3">
            <ComplianceBar value={value} />
            <span className="t-numeral">
              {value.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %
            </span>
            {/* En bloques angostos el sello cede lugar al nombre; la barra rayada ya marca la falla. */}
            {value < COMPLIANCE_THRESHOLD && (
              <span className="hidden @lg:inline-flex">
                <Stamp variant="fail">Revisar</Stamp>
              </span>
            )}
          </span>
        )}
      </TableCell>
      <TableCell className="w-12 text-right">
        <RowMenu
          label={row.name}
          groups={groups}
          drag={{
            onStart: (height) => {
              drag.start(row.id, height);
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
 * Ranking de cumplimiento con fijados. Los fijados (favoritos de esta pantalla) van arriba en el
 * orden que eligió el usuario y se guardan al instante; el resto sigue el orden del ajuste y se
 * puede mover solo durante esta visita. Cada fila tiene su menú ⋮; mantenerlo apretado permite
 * arrastrarla. Lo usan los bloques de predios y de vigiladores.
 */
export function ComplianceRanking({
  title,
  entityType,
  rows,
  query,
  sort,
  limit,
  nouns,
  link,
}: {
  title: string;
  entityType: FavoriteEntityType;
  /** undefined mientras carga o si falló. */
  rows: readonly RankingRow[] | undefined;
  query: { isPending: boolean; isError: boolean; refetch: () => unknown };
  sort: 'worst' | 'name';
  limit: '5' | '10' | 'all';
  nouns: RankingNouns;
  link: { to: string; label: string };
}) {
  const favorites = useFavorites('admin-summary', entityType);
  const [sessionOrder, setSessionOrder] = useState<readonly string[]>([]);
  const { announce, region } = useAnnouncer(`Cambios en la lista de ${nouns.plural}`);

  const sorted = sortByCompliance(rows ?? [], sort, 'all');
  const { pinned, rest } = partitionPinned(sorted, favorites.ids, rowId);
  const ordered = applyOrder(rest, sessionOrder, rowId);
  const shown = limit === 'all' ? ordered : ordered.slice(0, Number(limit));
  const pinnedIds = pinned.map(rowId);
  const orderedIds = ordered.map(rowId);
  const shownIds = shown.map(rowId);
  const nameOf = (id: string) => sorted.find((row) => row.id === id)?.name ?? 'El elemento';

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
  const pinGroup = (id: string): RowActionGroup => ({
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
  });
  const restGroups = (row: RankingRow): RowActionGroup[] => [
    ...(row.pinnable ? [pinGroup(row.id)] : []),
    {
      label: 'Solo en esta visita',
      actions: availableActions(orderedIds, row.id)
        .filter((action) => action === 'top' || action === 'bottom')
        .map((action) => ({
          key: action,
          label: MOVE_LABELS[action],
          onSelect: () => {
            setSessionOrder(moveId(orderedIds, row.id, action));
            announce(
              `${row.name} ${action === 'top' ? 'pasó al principio' : 'pasó al final'} (solo en esta visita).`,
            );
          },
        })),
    },
  ];

  if (!rows)
    return (
      <WidgetFrame title={title} link={link}>
        <WidgetStatus query={query} label={`los ${nouns.plural}`} />
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
        <WidgetEmpty>Sin {nouns.plural} con rondas en el período.</WidgetEmpty>
      ) : (
        <Table>
          <caption className="sr-only">
            Cumplimiento de {nouns.plural} en los últimos 30 días; los fijados van primero.
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead>{nouns.column}</TableHead>
              {/* En bloques angostos se ocultan: el nombre y el cumplimiento entran siempre. */}
              <TableHead className="hidden text-right @lg:table-cell">Ventanas</TableHead>
              <TableHead className="hidden text-right @lg:table-cell">No realizadas</TableHead>
              <TableHead>Cumplimiento</TableHead>
              <TableHead>
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          {pinned.length > 0 && (
            <TableBody aria-label={`${nouns.column}: fijados`} className="border-b-2 border-border">
              {pinned.map((row) => (
                <RankingRowView
                  key={row.id}
                  row={row}
                  pinned
                  drag={pinnedDrag}
                  groups={pinnedGroups(row.id)}
                />
              ))}
            </TableBody>
          )}
          <TableBody>
            {shown.map((row) => (
              <RankingRowView
                key={row.id}
                row={row}
                pinned={false}
                drag={restDrag}
                groups={restGroups(row)}
              />
            ))}
          </TableBody>
        </Table>
      )}
      <FavoritesNotice favorites={favorites} />
    </WidgetFrame>
  );
}

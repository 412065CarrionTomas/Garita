import { useMemo, type ReactNode } from 'react';
import { readingOrder, type LayoutItem, type ViewCatalog } from '@garita/shared';
import { cn } from '@/lib/utils';
import { scaleLayout } from './engine';
import { useGridColumns } from './use-grid-columns';

/**
 * Dibuja un diseño de bloques con CSS Grid: cada bloque ocupa `w` columnas y `h` filas de 48 px
 * con 24 px de separación (escala del sistema). Los bloques se emiten en orden de lectura, así el
 * orden del teclado y del lector de pantalla coincide con el visual. En pantallas más angostas el
 * diseño se adapta sin guardarse.
 */
export function LayoutGrid({
  catalog,
  items,
  renderItem,
  className,
  'aria-label': ariaLabel,
}: {
  catalog: ViewCatalog;
  items: readonly LayoutItem[];
  renderItem: (item: LayoutItem) => ReactNode;
  className?: string;
  'aria-label'?: string;
}) {
  const { columns } = useGridColumns(catalog.columns);
  const placed = useMemo(() => {
    const visible = scaleLayout(items, catalog.columns, columns).filter((item) => !item.hidden);
    return readingOrder(visible).flatMap((index) => visible[index] ?? []);
  }, [items, catalog.columns, columns]);
  return (
    <div
      aria-label={ariaLabel}
      className={cn('grid auto-rows-[--spacing(12)] gap-6', className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {placed.map((item) => (
        <div
          key={item.id}
          data-layout-item={item.id}
          className="min-h-0 min-w-0"
          style={{
            gridColumn: `${item.x + 1} / span ${item.w}`,
            gridRow: `${item.y + 1} / span ${item.h}`,
          }}
        >
          {renderItem(item)}
        </div>
      ))}
    </div>
  );
}

import { useId, useMemo, useRef, type Dispatch, type ReactNode } from 'react';
import { readingOrder, widgetMinSize, type LayoutItem, type ViewCatalog } from '@garita/shared';
import { useAnnouncer } from '@/lib/interaction/use-announcer';
import { useFlipAnimation } from '@/lib/interaction/use-flip-animation';
import { cn } from '@/lib/utils';
import { EditableItem } from './editable-item';
import type { EditorAction } from './editor-state';
import { scaleLayout } from './engine';
import { GRID_GUTTER, GRID_ROW } from './grid-metrics';
import { useGridColumns } from './use-grid-columns';

/** Tamaños permitidos de un bloque con su presentación actual. */
function limitsOf(catalog: ViewCatalog, item: LayoutItem) {
  const widget = Object.hasOwn(catalog.widgets, item.id) ? catalog.widgets[item.id] : undefined;
  return widget && { min: widgetMinSize(widget, item.presentation), max: widget.size.max };
}

/**
 * Dibuja un diseño de bloques con CSS Grid: cada bloque ocupa `w` columnas y `h` filas de
 * `GRID_ROW` px, y deja `GRID_GUTTER` px de separación a la derecha y abajo como relleno propio
 * (la grilla no tiene huecos, así las celdas son finas y la ubicación casi libre). Los bloques se emiten en orden de
 * lectura, así el orden del teclado y del lector de pantalla coincide con el visual. En pantallas
 * más angostas el diseño se adapta sin guardarse. Con `edit`, y solo con la grilla completa, cada
 * bloque muestra sus asas de edición y los demás se deslizan a su lugar nuevo al reacomodarse.
 */
export function LayoutGrid({
  catalog,
  items,
  renderItem,
  edit,
  className,
  'aria-label': ariaLabel,
}: {
  catalog: ViewCatalog;
  items: readonly LayoutItem[];
  renderItem: (item: LayoutItem) => ReactNode;
  edit?: {
    dispatch: Dispatch<EditorAction>;
    titleOf: (id: string) => string;
    /**
     * Orden fijo del DOM mientras se edita (ids). Reordenar nodos durante un arrastre haría que
     * el navegador pierda la captura del puntero y el foco; la posición visual la da la grilla.
     */
    order: readonly string[];
  };
  className?: string;
  'aria-label'?: string;
}) {
  const { columns, editable } = useGridColumns(catalog.columns);
  const gridRef = useRef<HTMLDivElement>(null);
  // Un gesto a la vez en toda la grilla, con el bloque dueño anotado: solo él puede liberarlo.
  const gestureOwner = useRef<string | null>(null);
  const gestureLock = useMemo(
    () => ({
      acquire: (owner: string) => {
        if (gestureOwner.current !== null) return false;
        gestureOwner.current = owner;
        return true;
      },
      release: (owner: string) => {
        if (gestureOwner.current === owner) gestureOwner.current = null;
      },
    }),
    [],
  );
  const instructionsId = useId();
  const { announce, region } = useAnnouncer('Cambios del diseño');
  const editing = edit !== undefined && editable;
  const stacked = columns === 1;
  const order = editing ? edit.order : undefined;
  const placed = useMemo(() => {
    const visible = scaleLayout(items, catalog.columns, columns).filter((item) => !item.hidden);
    if (!order) return readingOrder(visible).flatMap((index) => visible[index] ?? []);
    const rank = new Map(order.map((id, index) => [id, index]));
    const last = order.length;
    return [...visible].sort((a, b) => (rank.get(a.id) ?? last) - (rank.get(b.id) ?? last));
  }, [items, catalog.columns, columns, order]);
  useFlipAnimation(gridRef, editing, [placed]);
  return (
    <>
      {editing && (
        <>
          <p id={instructionsId} className="sr-only">
            Enter o Espacio toma el asa; las flechas mueven o cambian el tamaño de a un paso; Enter
            suelta y Escape cancela.
          </p>
          {region}
        </>
      )}
      <div
        ref={gridRef}
        aria-label={ariaLabel}
        data-editing={editing || undefined}
        // En una sola columna (celular) cada bloque toma su alto natural y se desplaza la página,
        // no cada bloque: cajas con desplazamiento propio apiladas se manejan mal con el dedo.
        className={cn('grid', className)}
        style={
          stacked
            ? { gridTemplateColumns: 'minmax(0, 1fr)', gap: GRID_GUTTER, gridAutoRows: 'auto' }
            : {
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gridAutoRows: GRID_ROW,
                // La separación del último bloque de cada fila sale por la derecha.
                marginRight: -GRID_GUTTER,
              }
        }
      >
        {placed.map((item) => (
          <div
            key={item.id}
            data-layout-item={item.id}
            data-flip-id={item.id}
            className="min-h-0 min-w-0"
            style={{
              gridColumn: `${item.x + 1} / span ${item.w}`,
              gridRow: stacked ? undefined : `${item.y + 1} / span ${item.h}`,
              paddingRight: stacked ? undefined : GRID_GUTTER,
              paddingBottom: stacked ? undefined : GRID_GUTTER,
            }}
          >
            {editing ? (
              <EditableItem
                item={item}
                limits={limitsOf(catalog, item)}
                title={edit.titleOf(item.id)}
                gridRef={gridRef}
                columns={columns}
                dispatch={edit.dispatch}
                announce={announce}
                instructionsId={instructionsId}
                gestureLock={gestureLock}
              >
                {renderItem(item)}
              </EditableItem>
            ) : (
              renderItem(item)
            )}
          </div>
        ))}
      </div>
    </>
  );
}

import { useRef, type Dispatch, type ReactNode, type RefObject } from 'react';
import { GripVertical, MoveDiagonal2 } from 'lucide-react';
import type { LayoutItem } from '@garita/shared';
import { usePointerDrag } from '@/lib/interaction/use-pointer-drag';
import { cn } from '@/lib/utils';
import type { EditorAction } from './editor-state';
import { deltaToCells, readGridMetrics, type GridMetrics } from './grid-metrics';

const handleClass =
  'absolute z-10 inline-flex size-9 items-center justify-center rounded-md border-[1.5px] border-foreground bg-card text-foreground hover:bg-muted';

/**
 * Bloque en modo edición: su contenido queda inerte (no se navega ni se enfoca adentro) y
 * aparecen dos asas, mover y cambiar tamaño. Las asas traducen el puntero a celdas desde la
 * posición que tenía el bloque al empezar el gesto, así el bloque no "deriva" mientras los
 * demás se acomodan.
 */
export function EditableItem({
  item,
  title,
  gridRef,
  columns,
  dispatch,
  children,
}: {
  item: LayoutItem;
  title: string;
  gridRef: RefObject<HTMLElement | null>;
  columns: number;
  dispatch: Dispatch<EditorAction>;
  children: ReactNode;
}) {
  const origin = useRef<{ item: LayoutItem; metrics: GridMetrics } | null>(null);
  const begin = () => {
    const grid = gridRef.current;
    if (!grid) return;
    origin.current = { item, metrics: readGridMetrics(grid, columns) };
    dispatch({ type: 'gestureStart' });
  };
  const end = () => {
    origin.current = null;
    dispatch({ type: 'gestureEnd' });
  };
  const cancel = () => {
    origin.current = null;
    dispatch({ type: 'gestureCancel' });
  };
  const move = usePointerDrag({
    onStart: begin,
    onMove: (delta) => {
      const start = origin.current;
      if (!start) return;
      const cells = deltaToCells(delta, start.metrics);
      dispatch({
        type: 'move',
        id: item.id,
        to: { x: start.item.x + cells.dx, y: start.item.y + cells.dy },
      });
    },
    onEnd: end,
    onCancel: cancel,
  });
  const resize = usePointerDrag({
    onStart: begin,
    onMove: (delta) => {
      const start = origin.current;
      if (!start) return;
      const cells = deltaToCells(delta, start.metrics);
      dispatch({
        type: 'resize',
        id: item.id,
        size: { w: start.item.w + cells.dx, h: start.item.h + cells.dy },
      });
    },
    onEnd: end,
    onCancel: cancel,
  });
  const active = move.dragging || resize.dragging;
  return (
    <div className="relative h-full" data-editing-item={item.id}>
      <div inert className="h-full select-none">
        {children}
      </div>
      {/* Marco punteado: el bloque es "programable", todavía no está fijo (sistema Foja). */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 rounded-md border-2 border-dashed border-foreground/60',
          active && 'border-solid border-foreground bg-foreground/5',
        )}
      />
      <button
        type="button"
        aria-label={`Mover ${title}`}
        className={cn(
          handleClass,
          'top-2 left-2 cursor-grab touch-none',
          move.dragging && 'cursor-grabbing',
        )}
        onPointerDown={move.onPointerDown}
      >
        <GripVertical aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`Cambiar el tamaño de ${title}`}
        className={cn(handleClass, 'right-2 bottom-2 cursor-nwse-resize touch-none')}
        onPointerDown={resize.onPointerDown}
      >
        <MoveDiagonal2 aria-hidden="true" />
      </button>
    </div>
  );
}

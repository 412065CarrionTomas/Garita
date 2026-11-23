import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type RefObject,
} from 'react';
import { GripVertical, MoveDiagonal2 } from 'lucide-react';
import type { LayoutItem, WidgetDefinition } from '@garita/shared';
import { useKeyboardGrab } from '@/lib/interaction/use-keyboard-grab';
import { usePointerDrag } from '@/lib/interaction/use-pointer-drag';
import { cn } from '@/lib/utils';
import { dragPreviewGeometry, type DragPreview } from './drag-preview';
import type { EditorAction } from './editor-state';
import { deltaToCells, readGridMetrics } from './grid-metrics';

const handleClass =
  'absolute z-10 inline-flex size-9 items-center justify-center rounded-md border-[1.5px] border-foreground bg-card text-foreground hover:bg-muted';

/** Posición y tamaño en palabras, para el lector de pantalla (columnas y filas desde 1). */
function describePlacement(item: LayoutItem): string {
  return `columna ${item.x + 1}, fila ${item.y + 1}, ${item.w} de ancho y ${item.h} de alto`;
}

/** Estilo del bloque mientras sigue al puntero (ver `dragPreviewGeometry`). */
function previewStyle(geometry: ReturnType<typeof dragPreviewGeometry>): CSSProperties {
  return geometry.kind === 'move'
    ? { transform: `translate(${geometry.dx}px, ${geometry.dy}px)` }
    : { position: 'absolute', top: 0, left: 0, width: geometry.width, height: geometry.height };
}

/**
 * Bloque en modo edición: su contenido queda inerte (no se navega ni se enfoca adentro) y
 * aparecen dos asas, mover y cambiar tamaño, que funcionan con puntero y con teclado. Con el
 * puntero, el desplazamiento se traduce a celdas desde la posición que tenía el bloque al
 * empezar (así no "deriva" mientras los demás se acomodan); mientras tanto el bloque sigue al
 * puntero de a píxel y un marco muestra la celda donde va a quedar. Con el teclado, el asa se toma con
 * Enter o Espacio y las flechas mueven o redimensionan de a un paso. En los dos casos el gesto
 * entero es un solo paso de "deshacer" y Escape vuelve a como estaba.
 */
export function EditableItem({
  item,
  limits,
  title,
  gridRef,
  columns,
  dispatch,
  announce,
  instructionsId,
  children,
}: {
  item: LayoutItem;
  /** Tamaños mínimo y máximo del bloque, para que la vista previa no pase de lo que se guarda. */
  limits: WidgetDefinition['size'] | undefined;
  title: string;
  gridRef: RefObject<HTMLElement | null>;
  columns: number;
  dispatch: Dispatch<EditorAction>;
  announce: (message: string) => void;
  /** Id del texto con las instrucciones de teclado, para `aria-describedby`. */
  instructionsId: string;
  children: ReactNode;
}) {
  // El gesto vive en una ref para los manejadores y en estado para dibujar la vista previa.
  const origin = useRef<DragPreview | null>(null);
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const busy = useRef(false);
  const current = useRef(item);
  useEffect(() => {
    current.current = item;
  });

  const beginPointer = (kind: DragPreview['kind']) => {
    const grid = gridRef.current;
    if (!grid || busy.current) return;
    busy.current = true;
    origin.current = {
      kind,
      start: item,
      metrics: readGridMetrics(grid, columns),
      delta: { dx: 0, dy: 0 },
    };
    setPreview(origin.current);
    dispatch({ type: 'gestureStart' });
  };
  const trackPointer = (delta: DragPreview['delta']) => {
    const start = origin.current;
    if (!start) return null;
    origin.current = { ...start, delta };
    setPreview(origin.current);
    return { start: start.start, cells: deltaToCells(delta, start.metrics) };
  };
  const endPointer = () => {
    if (!origin.current) return;
    origin.current = null;
    setPreview(null);
    busy.current = false;
    dispatch({ type: 'gestureEnd' });
    announce(`${title}: ${describePlacement(current.current)}.`);
  };
  const cancelPointer = () => {
    if (!origin.current) return;
    origin.current = null;
    setPreview(null);
    busy.current = false;
    dispatch({ type: 'gestureCancel' });
    announce(`Se canceló el cambio de ${title}.`);
  };
  const pointerMove = usePointerDrag({
    onStart: () => {
      beginPointer('move');
    },
    onMove: (delta) => {
      const step = trackPointer(delta);
      if (!step) return;
      dispatch({
        type: 'move',
        id: item.id,
        to: { x: step.start.x + step.cells.dx, y: step.start.y + step.cells.dy },
      });
    },
    onEnd: endPointer,
    onCancel: cancelPointer,
  });
  const pointerResize = usePointerDrag({
    onStart: () => {
      beginPointer('resize');
    },
    onMove: (delta) => {
      const step = trackPointer(delta);
      if (!step) return;
      dispatch({
        type: 'resize',
        id: item.id,
        size: { w: step.start.w + step.cells.dx, h: step.start.h + step.cells.dy },
      });
    },
    onEnd: endPointer,
    onCancel: cancelPointer,
  });

  const keyboard = (kind: 'move' | 'resize') => ({
    onGrab: () => {
      if (busy.current) return false;
      busy.current = true;
      dispatch({ type: 'gestureStart' });
      announce(
        kind === 'move'
          ? `${title} tomado, ${describePlacement(current.current)}. Usá las flechas para moverlo, Enter para soltarlo y Escape para cancelar.`
          : `Cambiando el tamaño de ${title}, ${describePlacement(current.current)}. Derecha e izquierda cambian el ancho, abajo y arriba el alto. Enter para terminar y Escape para cancelar.`,
      );
      return true;
    },
    onStep: (direction: 'up' | 'down' | 'left' | 'right') => {
      dispatch({ type: kind === 'move' ? 'step' : 'stepSize', id: item.id, direction });
    },
    onDrop: () => {
      busy.current = false;
      dispatch({ type: 'gestureEnd' });
      announce(`${title} quedó en ${describePlacement(current.current)}.`);
    },
    onCancel: () => {
      busy.current = false;
      dispatch({ type: 'gestureCancel' });
      announce(`Se canceló el cambio de ${title}.`);
    },
  });
  const keyMove = useKeyboardGrab(keyboard('move'));
  const keyResize = useKeyboardGrab(keyboard('resize'));
  const grabbed = keyMove.grabbed || keyResize.grabbed;

  // Cada paso de teclado se anuncia con la posición nueva (solo si cambió).
  const placement = describePlacement(item);
  const announced = useRef(placement);
  useEffect(() => {
    if (!grabbed) {
      announced.current = placement;
      return;
    }
    if (announced.current === placement) return;
    announced.current = placement;
    announce(`${title}: ${placement}.`);
  }, [grabbed, placement, title, announce]);

  const active = pointerMove.dragging || pointerResize.dragging || grabbed;
  const geometry = preview && dragPreviewGeometry(preview, item, limits, columns);
  return (
    <div className="relative h-full" data-editing-item={item.id}>
      {/* La celda donde va a quedar el bloque al soltarlo. */}
      {geometry && (
        <div
          aria-hidden="true"
          data-drop-target
          className="absolute inset-0 rounded-md border-2 border-dashed border-foreground/50 bg-foreground/5"
        />
      )}
      <div
        // Mientras sigue al puntero va por encima de los demás y no lo anima el reacomodo.
        data-flip-skip={geometry ? '' : undefined}
        className={cn(
          'relative h-full',
          geometry
            ? 'z-20 shadow-xl'
            : 'transition-transform duration-150 ease-out motion-reduce:transition-none',
        )}
        style={geometry ? previewStyle(geometry) : undefined}
      >
        <div inert className="h-full select-none">
          {children}
        </div>
        {/* Marco punteado: el bloque todavía no está fijo (sistema Foja); sólido mientras se mueve. */}
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
          aria-describedby={instructionsId}
          aria-pressed={keyMove.grabbed}
          className={cn(
            handleClass,
            // Sobre el borde superior, centrada: no tapa el título ni el contenido del bloque.
            'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none',
            (pointerMove.dragging || keyMove.grabbed) &&
              'cursor-grabbing bg-foreground text-background hover:bg-foreground',
          )}
          onPointerDown={pointerMove.onPointerDown}
          onKeyDown={keyMove.onKeyDown}
          onBlur={keyMove.onBlur}
        >
          <GripVertical aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Cambiar el tamaño de ${title}`}
          aria-describedby={instructionsId}
          aria-pressed={keyResize.grabbed}
          className={cn(
            handleClass,
            // Montada sobre la esquina inferior derecha, mitad afuera, en la separación entre bloques.
            'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize touch-none',
            (pointerResize.dragging || keyResize.grabbed) &&
              'bg-foreground text-background hover:bg-foreground',
          )}
          onPointerDown={pointerResize.onPointerDown}
          onKeyDown={keyResize.onKeyDown}
          onBlur={keyResize.onBlur}
        >
          <MoveDiagonal2 aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

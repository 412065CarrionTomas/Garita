import { useRef, useState, type CSSProperties } from 'react';
import { moveIdTo } from './reorder';

interface DragState {
  id: string;
  from: number;
  dy: number;
  height: number;
}

export interface SortableDrag {
  /** Fila que se está arrastrando, o null. */
  draggingId: string | null;
  /** Estilo de cada fila durante el arrastre: la arrastrada sigue al puntero, las demás le hacen lugar. */
  rowStyle: (id: string) => CSSProperties | undefined;
  start: (id: string, rowHeight: number) => void;
  move: (dy: number) => void;
  end: () => void;
  cancel: () => void;
}

/** Posición de destino según cuánto se desplazó el puntero (cambia a mitad de cada fila). */
export function targetIndex(from: number, dy: number, height: number, count: number): number {
  const steps = height > 0 ? Math.round(dy / height) : 0;
  return Math.min(Math.max(from + steps, 0), count - 1);
}

/**
 * Arrastre de filas de una lista sin reordenar el DOM mientras dura (moverlo haría que el
 * navegador pierda la captura del puntero): la fila arrastrada se traslada con `transform` y las
 * que quedan en el camino se corren una fila. Al soltar se informa el orden nuevo.
 */
export function useSortableDrag(
  ids: readonly string[],
  onReorder: (next: readonly string[], id: string, index: number) => void,
): SortableDrag {
  const [drag, setDragState] = useState<DragState | null>(null);
  // Espejo síncrono del estado: soltar lee de acá, así el efecto (onReorder) no queda dentro de
  // un actualizador de estado, que React puede ejecutar dos veces.
  const dragRef = useRef<DragState | null>(null);
  const setDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const start = (id: string, height: number) => {
    const from = ids.indexOf(id);
    if (from !== -1) setDrag({ id, from, dy: 0, height });
  };
  const move = (dy: number) => {
    if (dragRef.current) setDrag({ ...dragRef.current, dy });
  };
  const end = () => {
    const current = dragRef.current;
    setDrag(null);
    if (!current) return;
    const to = targetIndex(current.from, current.dy, current.height, ids.length);
    const next = moveIdTo(ids, current.id, to);
    if (next !== ids) onReorder(next, current.id, to);
  };
  const cancel = () => {
    setDrag(null);
  };
  const rowStyle = (id: string): CSSProperties | undefined => {
    if (!drag) return undefined;
    if (id === drag.id)
      return { transform: `translateY(${drag.dy}px)`, position: 'relative', zIndex: 1 };
    const index = ids.indexOf(id);
    const to = targetIndex(drag.from, drag.dy, drag.height, ids.length);
    if (drag.from < to && index > drag.from && index <= to)
      return { transform: `translateY(${-drag.height}px)` };
    if (drag.from > to && index >= to && index < drag.from)
      return { transform: `translateY(${drag.height}px)` };
    return undefined;
  };
  return { draggingId: drag?.id ?? null, rowStyle, start, move, end, cancel };
}

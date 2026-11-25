import { useState, type RefObject } from 'react';
import type { useColumnWidth } from '@/lib/use-column-width';
import { cn } from '@/lib/utils';

const KEY_STEP = 2;

/**
 * Separador vertical entre dos columnas: se arrastra con el mouse o el dedo, y con el teclado
 * (flechas, Inicio, Fin). `container` es el elemento cuyo ancho es el 100 %.
 */
export function ColumnResizer({
  label,
  container,
  column,
  className,
}: {
  label: string;
  container: RefObject<HTMLElement | null>;
  column: ReturnType<typeof useColumnWidth>;
  className?: string;
}) {
  const { width, min, max, set, save } = column;
  const [dragging, setDragging] = useState(false);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      className={cn(
        'group flex w-3 cursor-col-resize touch-none justify-center self-stretch',
        className,
      )}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!dragging) return;
        const box = container.current?.getBoundingClientRect();
        if (box?.width) set(((event.clientX - box.left) / box.width) * 100);
      }}
      onPointerUp={() => {
        setDragging(false);
        save(width);
      }}
      onKeyDown={(event) => {
        const next =
          event.key === 'ArrowLeft'
            ? width - KEY_STEP
            : event.key === 'ArrowRight'
              ? width + KEY_STEP
              : event.key === 'Home'
                ? min
                : event.key === 'End'
                  ? max
                  : undefined;
        if (next === undefined) return;
        event.preventDefault();
        set(next);
        save(Math.min(max, Math.max(min, next)));
      }}
    >
      <span
        aria-hidden="true"
        className={cn(
          'w-0.5 rounded-full bg-border group-hover:w-1 group-hover:bg-primary group-focus-visible:w-1 group-focus-visible:bg-primary',
          dragging && 'w-1 bg-primary',
        )}
      />
    </div>
  );
}

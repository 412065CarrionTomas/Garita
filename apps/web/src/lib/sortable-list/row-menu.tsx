import { Fragment, useRef, useState } from 'react';
import { EllipsisVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePointerDrag } from '@/lib/interaction/use-pointer-drag';
import { cn } from '@/lib/utils';

export interface RowAction {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}
export interface RowActionGroup {
  label?: string;
  actions: readonly RowAction[];
}
export interface RowDrag {
  onStart: (rowHeight: number) => void;
  onMove: (dy: number) => void;
  onEnd: () => void;
  onCancel: () => void;
}

/** Espera para que mantener apretado sea arrastrar y no un toque o un desplazamiento. */
const HOLD_TO_DRAG_MS = 300;
const FALLBACK_ROW_HEIGHT = 48;

/**
 * Menú ⋮ de una fila: un toque, clic, Enter o Espacio abre las acciones (que también son la
 * alternativa accesible al arrastre, WCAG 2.5.7); mantenerlo apretado lo convierte en asa para
 * arrastrar la fila. La fila debe llevar `data-sortable-row` para medir su alto.
 */
export function RowMenu({
  label,
  groups,
  drag,
}: {
  /** Nombre de la fila (p. ej. el predio), para el nombre accesible del botón. */
  label: string;
  groups: readonly RowActionGroup[];
  drag?: RowDrag;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const dragged = useRef(false);
  const pointer = usePointerDrag({
    holdMs: HOLD_TO_DRAG_MS,
    onStart: () => {
      dragged.current = true;
      const row = button.current?.closest('[data-sortable-row]');
      const height = row?.getBoundingClientRect().height ?? 0;
      // Sin layout (alto 0) se usa el alto típico de fila.
      drag?.onStart(height > 0 ? height : FALLBACK_ROW_HEIGHT);
    },
    onMove: ({ dy }) => drag?.onMove(dy),
    onEnd: () => {
      drag?.onEnd();
      // Solo se absorbe el click sintético que sigue al pointerup; si no llega, no queda pegado.
      setTimeout(() => {
        dragged.current = false;
      }, 0);
    },
    onCancel: () => {
      dragged.current = false;
      drag?.onCancel();
    },
  });
  const visibleGroups = groups.filter((group) => group.actions.length > 0);
  if (visibleGroups.length === 0) return null;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          ref={button}
          type="button"
          aria-label={`Acciones de ${label}`}
          className={cn(
            'inline-flex size-9 items-center justify-center rounded-md text-muted-foreground select-none hover:bg-muted hover:text-foreground',
            drag && 'cursor-grab touch-none',
            pointer.dragging && 'cursor-grabbing bg-muted text-foreground',
          )}
          onPointerDown={drag ? pointer.onPointerDown : undefined}
          onContextMenu={(event) => {
            // En táctil, mantener apretado abre el menú contextual del sistema.
            if (drag) event.preventDefault();
          }}
          onClick={() => {
            // Soltar después de arrastrar no abre el menú.
            if (dragged.current) {
              dragged.current = false;
              return;
            }
            setOpen(true);
          }}
        >
          <EllipsisVertical aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {visibleGroups.map((group, index) => (
          <Fragment key={group.label ?? index}>
            {index > 0 && <DropdownMenuSeparator />}
            {group.label && <DropdownMenuLabel>{group.label}</DropdownMenuLabel>}
            {group.actions.map((action) => (
              <DropdownMenuItem
                key={action.key}
                disabled={action.disabled}
                onSelect={action.onSelect}
              >
                {action.label}
              </DropdownMenuItem>
            ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

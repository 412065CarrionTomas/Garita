import { useSyncExternalStore } from 'react';

/** Desde este ancho se usa la grilla completa y se permite editar (decisión del producto). */
export const FULL_GRID_QUERY = '(min-width: 1024px)';
const HALF_GRID_QUERY = '(min-width: 640px)';

function matches(query: string): boolean {
  // Sin matchMedia (tests, navegadores muy viejos) se asume pantalla ancha.
  return typeof window.matchMedia !== 'function' || window.matchMedia(query).matches;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const lists = [FULL_GRID_QUERY, HALF_GRID_QUERY].map((query) => window.matchMedia(query));
  for (const list of lists) list.addEventListener('change', onChange);
  return () => {
    for (const list of lists) list.removeEventListener('change', onChange);
  };
}

function snapshot(): 'full' | 'half' | 'single' {
  if (matches(FULL_GRID_QUERY)) return 'full';
  return matches(HALF_GRID_QUERY) ? 'half' : 'single';
}

/**
 * Columnas con que se dibuja una grilla de `columns` según el ancho de la ventana: todas en
 * escritorio, la mitad en tablet y una sola en celular. Solo la grilla completa es editable.
 */
export function useGridColumns(columns: number): { columns: number; editable: boolean } {
  const size = useSyncExternalStore(subscribe, snapshot, () => 'full' as const);
  if (size === 'full') return { columns, editable: true };
  return { columns: size === 'half' ? Math.max(1, Math.ceil(columns / 2)) : 1, editable: false };
}

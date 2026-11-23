import type { LayoutItem, ViewCatalog } from '@garita/shared';
import {
  moveItem,
  resizeItem,
  sameLayout,
  setHidden,
  setPresentation,
  setSettings,
  stepItem,
  stepSize,
  type Cell,
  type Direction,
  type Size,
} from './engine';

/*
 * Estado del editor de bloques como reducer puro. Reglas:
 * - "view": se muestra el diseño guardado. "edit": se trabaja sobre un borrador; nada se guarda
 *   hasta que el usuario toca Guardar.
 * - Cada acción con efecto apila el borrador anterior para deshacer (como mucho HISTORY_LIMIT).
 * - Un gesto (arrastrar o redimensionar con el puntero) produce muchos pasos intermedios: solo el
 *   resultado final entra al historial, y cancelarlo vuelve al estado previo al gesto.
 */

export const HISTORY_LIMIT = 20;

type Items = readonly LayoutItem[];

export type EditorState =
  | { mode: 'view' }
  | {
      mode: 'edit';
      /** Diseño guardado al empezar: contra él se calcula si hay cambios. */
      base: Items;
      draft: Items;
      past: readonly Items[];
      /** Borrador al empezar el gesto en curso, o null si no hay gesto. */
      gesture: Items | null;
    };

export type EditorAction =
  | { type: 'start'; items: Items }
  | { type: 'cancel' }
  | { type: 'saved' }
  | { type: 'rebase'; items: Items }
  | { type: 'move'; id: string; to: Cell }
  | { type: 'resize'; id: string; size: Size }
  | { type: 'step'; id: string; direction: Direction }
  | { type: 'stepSize'; id: string; direction: Direction }
  | { type: 'hidden'; id: string; hidden: boolean }
  | { type: 'presentation'; id: string; presentation: string }
  | { type: 'settings'; id: string; patch: Record<string, unknown> }
  | { type: 'reset' }
  | { type: 'undo' }
  | { type: 'gestureStart' }
  | { type: 'gestureEnd' }
  | { type: 'gestureCancel' };

export const initialEditorState: EditorState = { mode: 'view' };

export function isDirty(state: EditorState): boolean {
  return state.mode === 'edit' && !sameLayout(state.base, state.draft);
}

export function canUndo(state: EditorState): boolean {
  return state.mode === 'edit' && state.gesture === null && state.past.length > 0;
}

export function createEditorReducer(catalog: ViewCatalog) {
  /** Aplica un borrador nuevo: sin efecto no cambia nada; durante un gesto no toca el historial. */
  function commit(state: Extract<EditorState, { mode: 'edit' }>, next: Items): EditorState {
    if (next === state.draft) return state;
    if (state.gesture) return { ...state, draft: next };
    return { ...state, draft: next, past: [...state.past, state.draft].slice(-HISTORY_LIMIT) };
  }

  return function editorReducer(state: EditorState, action: EditorAction): EditorState {
    if (action.type === 'start')
      return { mode: 'edit', base: action.items, draft: action.items, past: [], gesture: null };
    if (state.mode === 'view') return state;
    const { draft } = state;
    switch (action.type) {
      case 'cancel':
      case 'saved':
        return { mode: 'view' };
      case 'rebase':
        // Otro guardó mientras se editaba: el borrador se conserva y pasa a compararse con eso.
        return { ...state, base: action.items };
      case 'move':
        return commit(state, moveItem(catalog, draft, action.id, action.to));
      case 'resize':
        return commit(state, resizeItem(catalog, draft, action.id, action.size));
      case 'step':
        return commit(state, stepItem(catalog, draft, action.id, action.direction));
      case 'stepSize':
        return commit(state, stepSize(catalog, draft, action.id, action.direction));
      case 'hidden':
        return commit(state, setHidden(draft, action.id, action.hidden));
      case 'presentation':
        return commit(state, setPresentation(catalog, draft, action.id, action.presentation));
      case 'settings':
        return commit(state, setSettings(catalog, draft, action.id, action.patch));
      case 'reset':
        return sameLayout(draft, catalog.defaultLayout.items)
          ? state
          : commit(state, catalog.defaultLayout.items);
      case 'undo': {
        const previous = state.past.at(-1);
        if (!previous || state.gesture) return state;
        return { ...state, draft: previous, past: state.past.slice(0, -1) };
      }
      case 'gestureStart':
        return state.gesture ? state : { ...state, gesture: draft };
      case 'gestureEnd': {
        const before = state.gesture;
        if (!before) return state;
        if (sameLayout(before, draft)) return { ...state, gesture: null, draft: before };
        return {
          ...state,
          gesture: null,
          past: [...state.past, before].slice(-HISTORY_LIMIT),
        };
      }
      case 'gestureCancel':
        return state.gesture ? { ...state, draft: state.gesture, gesture: null } : state;
    }
  };
}

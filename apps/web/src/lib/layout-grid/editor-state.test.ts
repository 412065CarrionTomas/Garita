import { adminSummaryCatalog, type LayoutItem } from '@garita/shared';
import {
  HISTORY_LIMIT,
  canUndo,
  createEditorReducer,
  initialEditorState,
  isDirty,
  type EditorAction,
  type EditorState,
} from './editor-state';

const reduce = createEditorReducer(adminSummaryCatalog);
const saved = adminSummaryCatalog.defaultLayout.items;
const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(reduce, state);
const editing = () => run(initialEditorState, { type: 'start', items: saved });
const draftOf = (state: EditorState): readonly LayoutItem[] => {
  if (state.mode !== 'edit') throw new Error('no está editando');
  return state.draft;
};
const pos = (state: EditorState, id: string) => {
  const item = draftOf(state).find((entry) => entry.id === id);
  return item && [item.x, item.y, item.w, item.h];
};

it('fuera de edición ignora todo salvo empezar', () => {
  expect(run(initialEditorState, { type: 'undo' }, { type: 'reset' })).toBe(initialEditorState);
  const state = editing();
  expect(state).toMatchObject({ mode: 'edit', base: saved, draft: saved, past: [] });
  expect(isDirty(state)).toBe(false);
});

it('cada acción con efecto se puede deshacer y las acciones sin efecto no apilan', () => {
  let state = run(editing(), { type: 'move', id: 'attention', to: { x: 0, y: 0 } });
  expect(canUndo(state)).toBe(false);
  state = run(state, { type: 'hidden', id: 'account', hidden: true });
  state = run(state, { type: 'presentation', id: 'compliance', presentation: 'bars' });
  expect(isDirty(state)).toBe(true);
  expect(canUndo(state)).toBe(true);
  state = run(state, { type: 'undo' }, { type: 'undo' });
  expect(draftOf(state)).toBe(saved);
  expect(isDirty(state)).toBe(false);
  expect(run(state, { type: 'undo' })).toBe(state);
});

it('un gesto de arrastre entra al historial como un solo paso', () => {
  let state = run(
    editing(),
    { type: 'gestureStart' },
    { type: 'move', id: 'shiftsToday', to: { x: 8, y: 12 } },
    { type: 'move', id: 'shiftsToday', to: { x: 8, y: 20 } },
    { type: 'move', id: 'shiftsToday', to: { x: 16, y: 90 } },
  );
  expect(canUndo(state)).toBe(false);
  state = run(state, { type: 'gestureEnd' });
  expect(state.mode === 'edit' && state.past).toHaveLength(1);
  expect(draftOf(run(state, { type: 'undo' }))).toBe(saved);
});

it('cancelar el gesto vuelve a como estaba antes de empezarlo', () => {
  const state = run(
    editing(),
    { type: 'gestureStart' },
    { type: 'resize', id: 'compliance', size: { w: 12, h: 10 } },
    { type: 'gestureCancel' },
  );
  expect(draftOf(state)).toBe(saved);
  expect(state.mode === 'edit' && state.past).toEqual([]);
});

it('un gesto que termina donde empezó no deja rastro', () => {
  const state = run(
    editing(),
    { type: 'gestureStart' },
    { type: 'move', id: 'shiftsToday', to: { x: 16, y: 90 } },
    { type: 'move', id: 'shiftsToday', to: { x: 16, y: 17 } },
    { type: 'gestureEnd' },
  );
  expect(draftOf(state)).toBe(saved);
  expect(canUndo(state)).toBe(false);
});

it('restablecer vuelve al diseño por defecto y también se deshace', () => {
  const moved = run(editing(), { type: 'resize', id: 'compliance', size: { w: 24, h: 24 } });
  expect(pos(moved, 'compliance')).toEqual([0, 18, 24, 24]);
  const reset = run(moved, { type: 'reset' });
  expect(draftOf(reset)).toBe(adminSummaryCatalog.defaultLayout.items);
  expect(run(reset, { type: 'reset' })).toBe(reset);
  expect(pos(run(reset, { type: 'undo' }), 'compliance')).toEqual([0, 18, 24, 24]);
});

it('limita el historial', () => {
  let state = editing();
  for (let i = 0; i < HISTORY_LIMIT + 5; i++)
    state = run(state, {
      type: 'presentation',
      id: 'compliance',
      presentation: i % 2 ? 'line' : 'bars',
    });
  expect(state.mode === 'edit' && state.past).toHaveLength(HISTORY_LIMIT);
});

it('guardar o cancelar salen de edición; rebase conserva el borrador', () => {
  const moved = run(editing(), { type: 'hidden', id: 'account', hidden: true });
  const rebased = run(moved, { type: 'rebase', items: draftOf(moved) });
  expect(isDirty(rebased)).toBe(false);
  expect(draftOf(rebased)).toBe(draftOf(moved));
  expect(run(moved, { type: 'saved' })).toEqual({ mode: 'view' });
  expect(run(moved, { type: 'cancel' })).toEqual({ mode: 'view' });
});

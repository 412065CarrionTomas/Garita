import { useCallback, useEffect, useMemo, useReducer, type Dispatch } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  reconcileLayout,
  viewPreferenceInputSchema,
  viewPreferenceResponseSchema,
  VIEW_PREFERENCE_CONFLICT_CODE,
  type LayoutItem,
  type ViewCatalog,
  type ViewPreferenceResponse,
} from '@garita/shared';
import { z } from 'zod';
import { ApiError, apiDelete, apiGet, apiPut } from '@/lib/api-client';
import { sameLayout } from './engine';
import {
  canUndo,
  createEditorReducer,
  initialEditorState,
  isDirty,
  type EditorAction,
  type EditorState,
} from './editor-state';
import { useViewLayout, viewLayoutPath, viewLayoutQueryKey } from './use-view-layout';

export interface ViewLayoutEditor {
  catalog: ViewCatalog;
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  /** Lo que se dibuja: el borrador mientras se edita, si no el diseño guardado. */
  items: readonly LayoutItem[] | undefined;
  loadFailed: boolean;
  editing: boolean;
  dirty: boolean;
  canUndo: boolean;
  start: () => void;
  save: () => void;
  saving: boolean;
  saveFailed: boolean;
  /** Otro dispositivo o pestaña guardó mientras se editaba. */
  conflict: boolean;
  /** Conflicto: conservar el borrador para guardarlo encima de lo nuevo. */
  keepMine: () => Promise<void>;
  /** Conflicto: descartar el borrador y ver lo que guardó el otro. */
  takeTheirs: () => Promise<void>;
}

function isConflict(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 409) return false;
  const body: unknown = error.body;
  return (
    typeof body === 'object' &&
    body !== null &&
    'code' in body &&
    body.code === VIEW_PREFERENCE_CONFLICT_CODE
  );
}

/**
 * Editor del diseño de una pantalla: lee el diseño guardado, lo edita en un borrador y lo guarda
 * solo al confirmar. Guardar el diseño por defecto borra la preferencia (así el usuario recibe
 * las mejoras futuras del diseño por defecto). Concurrencia optimista: si otro guardó mientras
 * tanto, la API responde 409 y el usuario elige qué versión queda.
 */
export function useViewLayoutEditor(catalog: ViewCatalog): ViewLayoutEditor {
  const { items: saved, updatedAt, failed } = useViewLayout(catalog);
  const reducer = useMemo(() => createEditorReducer(catalog), [catalog]);
  const [state, dispatch] = useReducer(reducer, initialEditorState);
  const queryClient = useQueryClient();
  const queryKey = viewLayoutQueryKey(catalog.key);
  const path = viewLayoutPath(catalog.key);

  const mutation = useMutation({
    mutationFn: async ({
      items,
      base,
    }: {
      items: readonly LayoutItem[];
      base: string | null;
    }): Promise<ViewPreferenceResponse> => {
      if (sameLayout(items, catalog.defaultLayout.items)) {
        await apiDelete(path, z.undefined());
        return { layout: null, updatedAt: null };
      }
      return apiPut(
        path,
        { layout: { version: catalog.version, items: [...items] }, baseUpdatedAt: base },
        viewPreferenceInputSchema,
        viewPreferenceResponseSchema,
      );
    },
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
      dispatch({ type: 'saved' });
    },
  });

  const dirty = isDirty(state);
  // Cerrar o recargar con cambios sin guardar pide confirmación al navegador.
  // shortcut: la navegación interna no se bloquea porque la app usa BrowserRouter (useBlocker
  // necesita un router de datos); si se migra a createBrowserRouter, sumar useBlocker acá.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);

  const fetchLatest = useCallback(async () => {
    const latest = await queryClient.query({
      queryKey,
      queryFn: () => apiGet(path, viewPreferenceResponseSchema),
      staleTime: 0,
    });
    return reconcileLayout(catalog, latest.layout ?? catalog.defaultLayout).items;
  }, [catalog, path, queryClient, queryKey]);

  const { reset: resetMutation, mutate } = mutation;
  const conflict = isConflict(mutation.error);

  return {
    catalog,
    state,
    dispatch,
    items: state.mode === 'edit' ? state.draft : saved,
    loadFailed: failed,
    editing: state.mode === 'edit',
    dirty,
    canUndo: canUndo(state),
    start: () => {
      if (saved) dispatch({ type: 'start', items: saved });
    },
    save: () => {
      if (state.mode === 'edit') mutate({ items: state.draft, base: updatedAt });
    },
    saving: mutation.isPending,
    saveFailed: mutation.isError && !conflict,
    conflict,
    keepMine: async () => {
      const latest = await fetchLatest();
      dispatch({ type: 'rebase', items: latest });
      resetMutation();
    },
    takeTheirs: async () => {
      await fetchLatest();
      dispatch({ type: 'cancel' });
      resetMutation();
    },
  };
}

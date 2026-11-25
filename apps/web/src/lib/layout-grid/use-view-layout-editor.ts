import { useCallback, useMemo, useReducer, useRef, useState, type Dispatch } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  reconcileLayout,
  viewPreferenceInputSchema,
  viewPreferenceResponseSchema,
  VIEW_PREFERENCE_CONFLICT_CODE,
  VIEW_PREFERENCE_NO_BASE,
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
  /** Sale de la edición descartando el borrador y los avisos de guardado. */
  cancel: () => void;
  save: () => void;
  saving: boolean;
  /** Falló el guardado (solo mientras se edita). */
  saveFailed: boolean;
  /** Otro dispositivo o pestaña guardó mientras se editaba (solo mientras se edita). */
  conflict: boolean;
  /** Resolviendo un conflicto (se está trayendo el diseño guardado). */
  resolving: boolean;
  /** No se pudo traer el diseño guardado para resolver el conflicto. */
  resolveFailed: boolean;
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
        // Con la fecha base (o "null" si no había nada guardado), la API responde 409 si otra
        // pestaña guardó mientras tanto, igual que en el PUT.
        const query = base ? encodeURIComponent(base) : VIEW_PREFERENCE_NO_BASE;
        await apiDelete(`${path}?baseUpdatedAt=${query}`, z.undefined());
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

  const fetchLatest = useCallback(async () => {
    const latest = await queryClient.query({
      queryKey,
      queryFn: () => apiGet(path, viewPreferenceResponseSchema),
      staleTime: 0,
    });
    return reconcileLayout(catalog, latest.layout ?? catalog.defaultLayout).items;
  }, [catalog, path, queryClient, queryKey]);

  const { reset: resetMutation, mutate } = mutation;
  const editing = state.mode === 'edit';
  const [resolving, setResolving] = useState(false);
  const [resolveFailed, setResolveFailed] = useState(false);
  // Cambia al empezar o terminar una edición: una resolución que vuelve tarde no toca otra sesión.
  const session = useRef(0);

  /** Empieza una sesión nueva sin restos de la anterior (errores, conflicto, resolución). */
  const clearSession = () => {
    session.current += 1;
    resetMutation();
    setResolving(false);
    setResolveFailed(false);
  };

  /** Trae lo guardado y aplica la elección; si falla, el conflicto sigue a la vista con su aviso. */
  const resolve = async (apply: (latest: readonly LayoutItem[]) => void) => {
    const mine = session.current;
    setResolving(true);
    setResolveFailed(false);
    try {
      const latest = await fetchLatest();
      if (session.current !== mine) return;
      apply(latest);
      resetMutation();
    } catch {
      if (session.current === mine) setResolveFailed(true);
    } finally {
      if (session.current === mine) setResolving(false);
    }
  };

  const conflict = editing && isConflict(mutation.error);
  return {
    catalog,
    state,
    dispatch,
    items: editing ? state.draft : saved,
    loadFailed: failed,
    editing,
    dirty,
    canUndo: canUndo(state),
    start: () => {
      // Sin el diseño guardado no hay fecha base: guardar daría un 409 engañoso.
      if (!saved || failed) return;
      clearSession();
      dispatch({ type: 'start', items: saved });
    },
    cancel: () => {
      clearSession();
      dispatch({ type: 'cancel' });
    },
    save: () => {
      if (!editing || resolving) return;
      setResolveFailed(false);
      mutate({ items: state.draft, base: updatedAt });
    },
    saving: mutation.isPending,
    saveFailed: editing && mutation.isError && !conflict,
    conflict,
    resolving,
    resolveFailed: editing && resolveFailed,
    keepMine: () =>
      resolve((latest) => {
        dispatch({ type: 'rebase', items: latest });
      }),
    takeTheirs: () =>
      resolve(() => {
        dispatch({ type: 'cancel' });
      }),
  };
}

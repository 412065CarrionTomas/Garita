import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import {
  GUARD_ROUND_VERSIONS_MAX,
  guardRoundVersionSchema,
  guardRoundVersionsSchema,
  type GuardRoundVersion,
} from '@garita/shared';
import { apiGet } from './api-client';
import { loadError, type LoadError } from './cached-get';
import { auth } from './firebase';

/**
 * Versiones de ronda guardadas por id: el recorrido y el orden de una versión no cambian, así que
 * se piden una vez. Los nombres y la ubicación de los puntos sí pueden editarse sin versión nueva,
 * por eso lo guardado en disco se revalida una vez por día (y sin señal se usa igual).
 * Memoria para la sesión, AsyncStorage por usuario para sin señal y entre sesiones.
 * shortcut: no se borran versiones viejas del disco (pocos KB cada una); purgar si crece.
 */
const REVALIDATE_MS = 24 * 60 * 60 * 1000;
const memory = new Map<string, GuardRoundVersion>();
const inFlight = new Map<string, Promise<GuardRoundVersion | undefined>>();
let memoryUid: string | null = null;

const uid = () => auth.currentUser?.uid ?? 'anon';
const storageKey = (owner: string, id: string) => `round-version:${owner}:${id}`;
const storedSchema = z.object({ savedAt: z.number(), version: guardRoundVersionSchema });

/** Vacía la memoria: al cerrar sesión, para que el próximo usuario no vea lo de otro. */
export function clearRoundVersionsMemory() {
  memory.clear();
  inFlight.clear();
  memoryUid = null;
}

async function fromStorage(owner: string, id: string) {
  const raw = await AsyncStorage.getItem(storageKey(owner, id)).catch(() => null);
  if (!raw) return undefined;
  try {
    return storedSchema.safeParse(JSON.parse(raw)).data;
  } catch {
    return undefined;
  }
}

/** Pide a la API, en un solo pedido por tanda, las versiones que faltan o hay que revalidar. */
async function fetchMissing(owner: string, ids: string[]) {
  for (let i = 0; i < ids.length; i += GUARD_ROUND_VERSIONS_MAX) {
    const batch = ids.slice(i, i + GUARD_ROUND_VERSIONS_MAX);
    const versions = await apiGet(
      `/rondas/versiones?ids=${batch.map(encodeURIComponent).join(',')}`,
      guardRoundVersionsSchema,
    );
    // Si cambió el usuario mientras volvía la respuesta, no se guarda para el nuevo.
    if (uid() !== owner) return;
    for (const version of versions) {
      memory.set(version.id, version);
      const entry = JSON.stringify({ savedAt: Date.now(), version });
      void AsyncStorage.setItem(storageKey(owner, version.id), entry).catch(() => undefined);
    }
  }
}

/** Carga una tanda: primero el disco; lo que falta o está viejo va en un solo pedido a la API. */
async function load(owner: string, ids: string[]) {
  const toFetch: string[] = [];
  for (const id of ids) {
    const stored = await fromStorage(owner, id);
    if (uid() !== owner) return;
    if (stored) memory.set(id, stored.version);
    if (!stored || Date.now() - stored.savedAt > REVALIDATE_MS) toFetch.push(id);
  }
  if (toFetch.length) await fetchMissing(owner, toFetch);
}

/**
 * Devuelve las versiones pedidas que se pudieron conseguir. Las que ya están no tocan la red; las
 * que faltan van juntas en un pedido, y dos pantallas que piden la misma comparten la respuesta.
 * Sin señal devuelve lo que haya en el celular y `failed` avisa que alguna no llegó por la red;
 * solo falla si no consiguió ninguna. Una versión que la API no devuelve (no autorizada) no es
 * una falla de red.
 */
export async function getRoundVersions(
  ids: string[],
): Promise<{ versions: Map<string, GuardRoundVersion>; failed: boolean }> {
  const owner = uid();
  if (memoryUid !== owner) {
    clearRoundVersionsMemory();
    memoryUid = owner;
  }
  const unique = [...new Set(ids)];
  // Se registran en curso antes de cualquier espera: un pedido simultáneo las encuentra.
  const toLoad = unique.filter((id) => !memory.has(id) && !inFlight.has(id));
  if (toLoad.length) {
    const batch = load(owner, toLoad);
    for (const id of toLoad) {
      // Si la red falla, lo que salió del disco igual sirve.
      // Si cambió el usuario en el medio, no se devuelve lo que haya cargado el otro.
      const mine = () => (uid() === owner ? memory.get(id) : undefined);
      const pending = batch.then(mine, (cause: unknown) => {
        const own = mine();
        if (own) return own;
        throw cause;
      });
      inFlight.set(id, pending);
      // Solo borra su propia entrada: otro usuario pudo haber pedido el mismo id entretanto.
      void pending
        .finally(() => {
          if (inFlight.get(id) === pending) inFlight.delete(id);
        })
        .catch(() => undefined);
    }
  }
  const results = await Promise.allSettled(
    unique.map(async (id) => memory.get(id) ?? (await inFlight.get(id))),
  );
  const found = new Map<string, GuardRoundVersion>();
  results.forEach((result, i) => {
    const id = unique[i];
    if (id && result.status === 'fulfilled' && result.value) found.set(id, result.value);
  });
  const failure = results.find((result) => result.status === 'rejected');
  if (!found.size && failure?.status === 'rejected') throw failure.reason;
  return { versions: found, failed: Boolean(failure) };
}

/** Versiones de ronda para una pantalla, con estado de carga y error. */
export function useRoundVersions(ids: string[]) {
  const key = [...new Set(ids)].sort().join(',');
  const [state, setState] = useState<{
    key: string;
    versions: Map<string, GuardRoundVersion>;
    failed: boolean;
    error: LoadError;
  }>({ key: '', versions: new Map(), failed: false, error: null });
  useEffect(() => {
    let active = true;
    getRoundVersions(key ? key.split(',') : [])
      .then(({ versions, failed }) => {
        if (active) setState({ key, versions, failed, error: null });
      })
      .catch((cause: unknown) => {
        if (active) setState({ key, versions: new Map(), failed: true, error: loadError(cause) });
      });
    return () => {
      active = false;
    };
  }, [key]);
  const current = state.key === key;
  return {
    versions: current ? state.versions : new Map<string, GuardRoundVersion>(),
    /** Alguna versión no llegó por falta de red (se muestran las del celular). */
    partial: current && state.failed && state.versions.size > 0,
    loading: !current,
    error: current ? state.error : null,
  };
}

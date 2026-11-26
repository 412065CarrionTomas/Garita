import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  GUARD_ROUND_VERSIONS_MAX,
  guardRoundVersionSchema,
  guardRoundVersionsSchema,
  type GuardRoundVersion,
} from '@garita/shared';
import { apiGet } from './api-client';
import { loadError, type LoadError } from './cached-get';

/**
 * Las versiones de ronda no cambian nunca: se guardan por id y no se vuelven a pedir.
 * Memoria para lo de esta sesión, AsyncStorage para sin señal y entre sesiones.
 * shortcut: no se borran versiones viejas (pocos KB cada una); purgar si crece la cantidad.
 */
const memory = new Map<string, GuardRoundVersion>();
const inFlight = new Map<string, Promise<GuardRoundVersion | undefined>>();
const storageKey = (id: string) => `round-version:${id}`;

async function fromStorage(id: string) {
  const raw = await AsyncStorage.getItem(storageKey(id)).catch(() => null);
  if (!raw) return undefined;
  try {
    return guardRoundVersionSchema.safeParse(JSON.parse(raw)).data;
  } catch {
    return undefined;
  }
}

/** Pide a la API, en un solo pedido por tanda, las versiones que no están en el celular. */
async function fetchMissing(ids: string[]) {
  for (let i = 0; i < ids.length; i += GUARD_ROUND_VERSIONS_MAX) {
    const batch = ids.slice(i, i + GUARD_ROUND_VERSIONS_MAX);
    const versions = await apiGet(
      `/rondas/versiones?ids=${batch.map(encodeURIComponent).join(',')}`,
      guardRoundVersionsSchema,
    );
    for (const version of versions) {
      memory.set(version.id, version);
      void AsyncStorage.setItem(storageKey(version.id), JSON.stringify(version)).catch(
        () => undefined,
      );
    }
  }
}

/** Carga una tanda: primero el disco, y las que no estén, en un solo pedido a la API. */
async function load(ids: string[]) {
  const missing: string[] = [];
  for (const id of ids) {
    const stored = await fromStorage(id);
    if (stored) memory.set(id, stored);
    else missing.push(id);
  }
  if (missing.length) await fetchMissing(missing);
}

/**
 * Devuelve las versiones pedidas. Las que ya están (memoria o disco) no tocan la red; las que
 * faltan van juntas en un pedido, y dos pantallas que piden la misma comparten la respuesta.
 */
export async function getRoundVersions(ids: string[]): Promise<Map<string, GuardRoundVersion>> {
  const unique = [...new Set(ids)];
  // Se registran en curso antes de cualquier espera: un pedido simultáneo las encuentra.
  const toLoad = unique.filter((id) => !memory.has(id) && !inFlight.has(id));
  if (toLoad.length) {
    const batch = load(toLoad);
    for (const id of toLoad) {
      // Si la red falla, lo que salió del disco igual sirve.
      const pending = batch.then(
        () => memory.get(id),
        (cause: unknown) => {
          if (memory.has(id)) return memory.get(id);
          throw cause;
        },
      );
      inFlight.set(id, pending);
      void pending.finally(() => inFlight.delete(id)).catch(() => undefined);
    }
  }
  const found = new Map<string, GuardRoundVersion>();
  for (const id of unique) {
    const version = memory.get(id) ?? (await inFlight.get(id));
    if (version) found.set(id, version);
  }
  return found;
}

/** Versiones de ronda para una pantalla, con estado de carga y error. */
export function useRoundVersions(ids: string[]) {
  const key = [...new Set(ids)].sort().join(',');
  const [state, setState] = useState<{
    key: string;
    versions: Map<string, GuardRoundVersion>;
    error: LoadError;
  }>({ key: '', versions: new Map(), error: null });
  useEffect(() => {
    let active = true;
    getRoundVersions(key ? key.split(',') : [])
      .then((versions) => {
        if (active) setState({ key, versions, error: null });
      })
      .catch((cause: unknown) => {
        if (active) setState({ key, versions: new Map(), error: loadError(cause) });
      });
    return () => {
      active = false;
    };
  }, [key]);
  const current = state.key === key;
  return {
    versions: current ? state.versions : new Map<string, GuardRoundVersion>(),
    loading: !current,
    error: current ? state.error : null,
  };
}

/** Solo para tests: vacía la memoria entre casos. */
export function clearRoundVersionsMemory() {
  memory.clear();
  inFlight.clear();
}

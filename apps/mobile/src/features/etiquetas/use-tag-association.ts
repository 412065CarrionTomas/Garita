import { useCallback, useEffect, useRef, useState } from 'react';
import * as Network from 'expo-network';
import { z } from 'zod';
import { normalizeNfcUid, secureTagStepResponseSchema } from '@garita/shared';
import { ApiError, apiDelete, apiRequest } from '@/lib/api-client';
import { cancelNfcRead, readNfcTag } from '@/lib/nfc';
import { NotSecureNfcTag, withSecureNfcTag } from '@/lib/nfc-secure';
import { playSuccessFeedback } from '@/features/escaneo/feedback';

const resultSchema = z.looseObject({ id: z.string(), status: z.string() });
const emptySchema = z.unknown();
// Tope de comandos del relevo seguro: la configuración real usa bastantes menos.
const MAX_SECURE_STEPS = 23;
const UNAVAILABLE = 'Esta etiqueta no está disponible para tu empresa.';

/** Qué se reintenta si falla: asociar o quitar. */
export type TagAction = 'associate' | 'remove';

/** En qué va la asociación de una etiqueta: es lo que muestra la hoja de escaneo. */
export type TagPhase =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'configuring'; step: number }
  | { kind: 'proof' }
  | { kind: 'saving' }
  | { kind: 'move'; uid: string; otherName: string }
  | { kind: 'confirmRemove' }
  | { kind: 'done'; secure: boolean }
  | { kind: 'removed' }
  | { kind: 'error'; action: TagAction; message: string };

export interface TagTarget {
  id: string;
  name: string;
}

const path = (id: string) => `/puntos/${encodeURIComponent(id)}`;

/** La lectura se canceló (hoja cerrada u otro punto): se corta sin mostrar error. */
class Superseded extends Error {}

/**
 * Asocia, mueve o quita la etiqueta de un punto. Una etiqueta segura (NTAG 424) se configura por
 * relevo con la API y se confirma con una lectura de prueba; una común se asocia por su UID.
 * `onChanged` corre después de cada cambio guardado para refrescar la lista.
 */
export function useTagAssociation(onChanged: () => void) {
  const [phase, setPhase] = useState<TagPhase>({ kind: 'idle' });
  // Cada operación tiene su número: si se canceló, ya no toca la hoja, la API ni el lector.
  const run = useRef(0);

  useEffect(
    () => () => {
      run.current++;
      void cancelNfcRead();
    },
    [],
  );

  const succeed = useCallback(
    (secure: boolean) => {
      onChanged();
      setPhase({ kind: 'done', secure });
      // La vibración y el sonido nunca fallan: la etiqueta ya quedó guardada.
      void playSuccessFeedback();
    },
    [onChanged],
  );

  const associateUid = useCallback(
    async (point: TagTarget, uid: string, confirmMove: boolean, current: number) => {
      try {
        await apiRequest('PUT', `${path(point.id)}/etiqueta-nfc`, resultSchema, {
          uid: normalizeNfcUid(uid),
          confirmMove,
        });
        if (run.current === current) succeed(false);
      } catch (error) {
        if (run.current !== current) return;
        const payload = (error instanceof ApiError ? error.payload : undefined) as
          { code?: unknown; checkpointName?: unknown } | undefined;
        if (payload?.code === 'NFC_TAG_MOVE_CONFIRMATION_REQUIRED') {
          const otherName =
            typeof payload.checkpointName === 'string' ? payload.checkpointName : 'otro punto';
          setPhase({ kind: 'move', uid, otherName });
        } else if (error instanceof ApiError && error.status === 422)
          setPhase({ kind: 'error', action: 'associate', message: UNAVAILABLE });
        // Otro 409 es una carrera con otra asociación: la API ya explica qué hacer.
        else if (error instanceof ApiError && error.status === 409)
          setPhase({ kind: 'error', action: 'associate', message: error.message });
        else
          setPhase({
            kind: 'error',
            action: 'associate',
            message: 'No se pudo guardar la etiqueta. Revisá la conexión.',
          });
      }
    },
    [succeed],
  );

  const associate = useCallback(
    async (point: TagTarget) => {
      const current = ++run.current;
      const alive = () => run.current === current;
      setPhase({ kind: 'reading' });
      try {
        const network = await Network.getNetworkStateAsync();
        if (!alive()) return;
        if (!network.isConnected || network.isInternetReachable === false) {
          setPhase({
            kind: 'error',
            action: 'associate',
            message: 'Se necesita conexión para asociar una etiqueta.',
          });
          return;
        }
        const sessionId = await withSecureNfcTag(async (tag) => {
          if (!alive()) throw new Superseded();
          setPhase({ kind: 'configuring', step: 0 });
          let step = await apiRequest(
            'POST',
            `${path(point.id)}/etiqueta-segura/configuracion`,
            secureTagStepResponseSchema,
            { uid: tag.uid, version: tag.version },
          );
          for (let i = 0; step.apdu && i < MAX_SECURE_STEPS; i++) {
            if (!alive()) throw new Superseded();
            const response = await tag.transceive(step.apdu);
            if (!alive()) throw new Superseded();
            step = await apiRequest(
              'POST',
              `/etiquetas-seguras/configuracion/${encodeURIComponent(step.sessionId)}/comando`,
              secureTagStepResponseSchema,
              { response },
            );
            if (alive()) setPhase({ kind: 'configuring', step: i + 1 });
          }
          if (!step.complete) throw new Error('Configuración incompleta');
          return step.sessionId;
        });
        if (!alive()) return;
        setPhase({ kind: 'proof' });
        const proof = await readNfcTag();
        if (!alive()) return;
        if (!proof.sdmMessage) throw new Error('Lectura de prueba sin SUN');
        await apiRequest(
          'POST',
          `/etiquetas-seguras/configuracion/${encodeURIComponent(sessionId)}/confirmar`,
          resultSchema,
          { sdmMessage: proof.sdmMessage },
        );
        if (alive()) succeed(true);
      } catch (error) {
        if (!alive()) return;
        if (error instanceof NotSecureNfcTag) await associateUid(point, error.uid, false, current);
        else if (error instanceof ApiError && error.status === 422)
          setPhase({ kind: 'error', action: 'associate', message: UNAVAILABLE });
        // 409 (otro punto u otra clave maestra) y 503 (sin clave): reintentar no lo arregla.
        else if (error instanceof ApiError && (error.status === 409 || error.status === 503))
          setPhase({ kind: 'error', action: 'associate', message: error.message });
        else
          setPhase({
            kind: 'error',
            action: 'associate',
            message: 'La configuración no se completó. Volvé a acercar la etiqueta.',
          });
      } finally {
        // Si ya empezó otra lectura (otro punto de la serie), no se la corta.
        if (alive()) await cancelNfcRead();
      }
    },
    [associateUid, succeed],
  );

  const confirmMove = useCallback(
    async (point: TagTarget) => {
      if (phase.kind !== 'move') return;
      const current = ++run.current;
      setPhase({ kind: 'saving' });
      await associateUid(point, phase.uid, true, current);
    },
    [associateUid, phase],
  );

  /** Pide confirmación en la misma hoja: un Alert sobre un Modal puede no verse en iOS. */
  const askRemove = useCallback(() => setPhase({ kind: 'confirmRemove' }), []);

  const remove = useCallback(
    async (point: TagTarget) => {
      const current = ++run.current;
      setPhase({ kind: 'saving' });
      try {
        await apiDelete(`${path(point.id)}/etiqueta-nfc`, emptySchema);
        if (run.current !== current) return;
        onChanged();
        setPhase({ kind: 'removed' });
      } catch {
        if (run.current === current)
          setPhase({
            kind: 'error',
            action: 'remove',
            message: 'No se pudo quitar la etiqueta. Revisá la conexión.',
          });
      }
    },
    [onChanged],
  );

  /** Corta la lectura en curso y deja la hoja quieta. */
  const reset = useCallback(() => {
    run.current++;
    setPhase({ kind: 'idle' });
    void cancelNfcRead();
  }, []);

  return { phase, associate, confirmMove, askRemove, remove, reset };
}

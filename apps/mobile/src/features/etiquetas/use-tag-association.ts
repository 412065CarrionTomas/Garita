import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import * as Network from 'expo-network';
import { z } from 'zod';
import { normalizeNfcUid, secureTagStepResponseSchema } from '@garita/shared';
import { ApiError, apiDelete, apiRequest } from '@/lib/api-client';
import { cancelNfcRead, readNfcTag } from '@/lib/nfc';
import { NotSecureNfcTag, withSecureNfcTag } from '@/lib/nfc-secure';

const resultSchema = z.looseObject({ id: z.string(), status: z.string() });
const emptySchema = z.unknown();
// Tope de comandos del relevo seguro: la configuración real usa bastantes menos.
const MAX_SECURE_STEPS = 23;

/** En qué va la asociación de una etiqueta: es lo que muestra la hoja de escaneo. */
export type TagPhase =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'configuring'; step: number }
  | { kind: 'proof' }
  | { kind: 'move'; uid: string; otherName: string }
  | { kind: 'done'; secure: boolean }
  | { kind: 'removed' }
  | { kind: 'error'; message: string };

export interface TagTarget {
  id: string;
  name: string;
}

const path = (id: string) => `/puntos/${encodeURIComponent(id)}`;

/**
 * Asocia, mueve o quita la etiqueta de un punto. Una etiqueta segura (NTAG 424) se configura por
 * relevo con la API y se confirma con una lectura de prueba; una común se asocia por su UID.
 * `onChanged` corre después de cada cambio guardado para refrescar la lista.
 */
export function useTagAssociation(onChanged: () => void) {
  const [phase, setPhase] = useState<TagPhase>({ kind: 'idle' });
  const player = useAudioPlayer(require('../../../assets/sounds/nfc-confirmation.wav'));
  // Cada lectura tiene su número: si se canceló, su error no pisa la hoja.
  const run = useRef(0);

  useEffect(
    () => () => {
      run.current++;
      void cancelNfcRead();
    },
    [],
  );

  const succeed = useCallback(
    async (secure: boolean) => {
      onChanged();
      setPhase({ kind: 'done', secure });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      player.seekTo(0);
      player.play();
    },
    [onChanged, player],
  );

  const associateUid = useCallback(
    async (point: TagTarget, uid: string, confirmMove: boolean, current: number) => {
      try {
        await apiRequest('PUT', `${path(point.id)}/etiqueta-nfc`, resultSchema, {
          uid: normalizeNfcUid(uid),
          confirmMove,
        });
        if (run.current === current) await succeed(false);
      } catch (error) {
        if (run.current !== current) return;
        if (error instanceof ApiError && error.status === 409) {
          const payload = error.payload as { checkpointName?: unknown } | undefined;
          const otherName =
            typeof payload?.checkpointName === 'string' ? payload.checkpointName : 'otro punto';
          setPhase({ kind: 'move', uid, otherName });
        } else if (error instanceof ApiError && error.status === 422)
          setPhase({ kind: 'error', message: 'Esta etiqueta no está disponible para tu empresa.' });
        else
          setPhase({
            kind: 'error',
            message: 'No se pudo guardar la etiqueta. Revisá la conexión.',
          });
      }
    },
    [succeed],
  );

  const associate = useCallback(
    async (point: TagTarget) => {
      const current = ++run.current;
      setPhase({ kind: 'reading' });
      try {
        const network = await Network.getNetworkStateAsync();
        if (!network.isConnected || network.isInternetReachable === false) {
          setPhase({ kind: 'error', message: 'Se necesita conexión para asociar una etiqueta.' });
          return;
        }
        const sessionId = await withSecureNfcTag(async (tag) => {
          setPhase({ kind: 'configuring', step: 0 });
          let step = await apiRequest(
            'POST',
            `${path(point.id)}/etiqueta-segura/configuracion`,
            secureTagStepResponseSchema,
            { uid: tag.uid, version: tag.version },
          );
          for (let i = 0; step.apdu && i < MAX_SECURE_STEPS; i++) {
            const response = await tag.transceive(step.apdu);
            step = await apiRequest(
              'POST',
              `/etiquetas-seguras/configuracion/${encodeURIComponent(step.sessionId)}/comando`,
              secureTagStepResponseSchema,
              { response },
            );
            if (run.current === current) setPhase({ kind: 'configuring', step: i + 1 });
          }
          if (!step.complete) throw new Error('Configuración incompleta');
          return step.sessionId;
        });
        if (run.current !== current) return;
        setPhase({ kind: 'proof' });
        const proof = await readNfcTag();
        if (!proof.sdmMessage) throw new Error('Lectura de prueba sin SUN');
        await apiRequest(
          'POST',
          `/etiquetas-seguras/configuracion/${encodeURIComponent(sessionId)}/confirmar`,
          resultSchema,
          { sdmMessage: proof.sdmMessage },
        );
        if (run.current === current) await succeed(true);
      } catch (error) {
        if (run.current !== current) return;
        if (error instanceof NotSecureNfcTag) await associateUid(point, error.uid, false, current);
        else if (error instanceof ApiError && error.status === 422)
          setPhase({ kind: 'error', message: 'Esta etiqueta no está disponible para tu empresa.' });
        else
          setPhase({
            kind: 'error',
            message: 'La configuración no se completó. Volvé a acercar la etiqueta.',
          });
      } finally {
        // Si ya empezó otra lectura (otro punto de la serie), no se la corta.
        if (run.current === current) await cancelNfcRead();
      }
    },
    [associateUid, succeed],
  );

  const confirmMove = useCallback(
    async (point: TagTarget) => {
      if (phase.kind !== 'move') return;
      const current = ++run.current;
      setPhase({ kind: 'reading' });
      await associateUid(point, phase.uid, true, current);
    },
    [associateUid, phase],
  );

  const remove = useCallback(
    async (point: TagTarget) => {
      const current = ++run.current;
      try {
        await apiDelete(`${path(point.id)}/etiqueta-nfc`, emptySchema);
        if (run.current !== current) return;
        onChanged();
        setPhase({ kind: 'removed' });
      } catch {
        if (run.current === current)
          setPhase({
            kind: 'error',
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

  return { phase, associate, confirmMove, remove, reset };
}

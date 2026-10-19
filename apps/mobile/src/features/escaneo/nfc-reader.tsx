import { useCallback, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { ShiftOfflineData } from '@garita/shared';
import { Banner, Button, Card, Text } from '@/ui';
import { cancelNfcRead, nfcAvailability, openNfcSettings, readFactoryUid } from '@/lib/nfc';
import { processScan } from './scan-action';

export function NfcReader({ shiftData, onQr }: { shiftData: ShiftOfflineData; onQr?: () => void }) {
  const [availability, setAvailability] =
    useState<Awaited<ReturnType<typeof nfcAvailability>>>('unsupported');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const processing = useRef(false);
  const reading = useRef(false);
  const latestScan = useRef(0);
  const scan = useCallback(
    async (uid: string) => {
      if (!active.current || processing.current) return;
      processing.current = true;
      const scanId = ++latestScan.current;
      setBusy(true);
      try {
        const result = await processScan(uid, shiftData, 'nfc', (saved) => {
          processing.current = false;
          if (active.current) {
            setMessage(saved.message);
            setBusy(false);
          }
        });
        if (active.current && scanId === latestScan.current) setMessage(result.message);
      } catch {
        if (active.current && scanId === latestScan.current)
          setMessage('No pudimos guardar la lectura. Volvé a acercar la etiqueta.');
      } finally {
        if (scanId === latestScan.current) {
          processing.current = false;
          if (active.current) setBusy(false);
        }
      }
    },
    [shiftData],
  );

  useFocusEffect(
    useCallback(() => {
      let disposed = false;
      // Serialize restart and cleanup so returning from settings cannot leave a hidden reader.
      let lifecycle = Promise.resolve();
      const refresh = () => {
        active.current = false;
        lifecycle = lifecycle
          .then(async () => {
            await cancelNfcRead();
            if (disposed || AppState.currentState !== 'active') return;
            const state = await nfcAvailability();
            if (disposed) return;
            active.current = true;
            setAvailability(state);
            if (state === 'ready' && Platform.OS === 'android')
              await readFactoryUid((uid) => void scan(uid));
          })
          .catch(() => {
            if (!disposed) setMessage('No pudimos iniciar la lectura. Volvé a abrir la pantalla.');
          });
      };
      refresh();
      const subscription = AppState.addEventListener('change', refresh);
      return () => {
        disposed = true;
        active.current = false;
        subscription.remove();
        void lifecycle.then(cancelNfcRead);
      };
    }, [scan]),
  );

  const read = async () => {
    if (processing.current || reading.current) return;
    reading.current = true;
    setBusy(true);
    try {
      await scan(await readFactoryUid());
    } catch {
      if (active.current) setMessage('Lectura cancelada o etiqueta no legible. Volvé a intentar.');
    } finally {
      reading.current = false;
      if (active.current) setBusy(false);
    }
  };

  const qrButton = onQr && (
    <Button
      label="Escanear código QR"
      size="lg"
      variant={
        availability === 'ready' && shiftData.checkpoints.some((point) => point.nfcUid)
          ? 'secondary'
          : 'signal'
      }
      onPress={onQr}
    />
  );
  if (availability === 'unsupported') return qrButton || null;
  return (
    <>
      <Card>
        {availability === 'disabled' ? (
          <>
            <Banner tone="warning">El NFC está apagado</Banner>
            <Button
              label="Abrir ajustes"
              onPress={() =>
                void openNfcSettings().catch(() => setMessage('No pudimos abrir los ajustes.'))
              }
            />
          </>
        ) : (
          <>
            <Text>
              {shiftData.checkpoints.some((point) => point.nfcUid)
                ? 'Acercá el celular a la etiqueta del punto. También podés usar el código QR.'
                : 'Podés registrar con una etiqueta o con el código QR.'}
            </Text>
            {Platform.OS === 'ios' && (
              <Button
                label="Leer etiqueta"
                size="lg"
                loading={busy}
                disabled={busy}
                onPress={() => void read()}
              />
            )}
            {Platform.OS === 'android' && <Text>Lectura de etiquetas activa</Text>}
          </>
        )}
        {!!message && (
          <Text accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {message}
          </Text>
        )}
      </Card>
      {qrButton}
    </>
  );
}

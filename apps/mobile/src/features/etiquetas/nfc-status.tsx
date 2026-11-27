import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { Banner, Button } from '@/ui';
import { nfcAvailability, openNfcSettings } from '@/lib/nfc';

export type NfcState = 'checking' | 'unsupported' | 'disabled' | 'ready';

/** Si el celular puede leer etiquetas. Se vuelve a mirar al volver de los ajustes de Android. */
export function useNfcState() {
  const [state, setState] = useState<NfcState>('checking');
  useEffect(() => {
    let mounted = true;
    const check = () =>
      void nfcAvailability()
        .then((next) => {
          if (mounted) setState(next);
        })
        .catch(() => {
          if (mounted) setState('unsupported');
        });
    check();
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') check();
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return state;
}

/** Aviso que bloquea el escaneo; no se muestra nada mientras NFC funciona. */
export function NfcBlocker({ state }: { state: NfcState }) {
  if (state === 'unsupported')
    return <Banner tone="warning">Tu celular no puede leer etiquetas NFC.</Banner>;
  if (state !== 'disabled') return null;
  return (
    <>
      <Banner tone="warning">NFC está apagado. Activalo para leer etiquetas.</Banner>
      <Button
        variant="outline"
        label="Activar NFC"
        accessibilityLabel="Abrir ajustes de NFC"
        onPress={() => void openNfcSettings()}
      />
    </>
  );
}

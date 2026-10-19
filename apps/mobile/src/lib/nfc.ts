import { Platform } from 'react-native';
import type * as NfcModule from 'react-native-nfc-manager';

// shortcut: Expo Go y web no tienen el módulo nativo y la librería lanza al cargarse; se requiere recién al usarla y, si falla, NFC queda como no soportado. Para NFC real hace falta un development build.
function loadNfc(): typeof NfcModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- import estático lanzaría en Expo Go y web
    return require('react-native-nfc-manager') as typeof NfcModule;
  } catch {
    return null;
  }
}

export async function nfcAvailability(): Promise<'unsupported' | 'disabled' | 'ready'> {
  const nfc = loadNfc();
  if (!nfc || !(await nfc.default.isSupported())) return 'unsupported';
  await nfc.default.start();
  if (Platform.OS === 'android' && !(await nfc.default.isEnabled())) return 'disabled';
  return 'ready';
}

export async function readFactoryUid(): Promise<string> {
  const nfc = loadNfc();
  if (!nfc) throw new Error('NFC no está disponible en este dispositivo');
  const technologies =
    Platform.OS === 'android'
      ? [nfc.NfcTech.NfcA, nfc.NfcTech.NfcV]
      : [nfc.NfcTech.MifareIOS, nfc.NfcTech.Iso15693IOS];
  try {
    await nfc.default.requestTechnology(technologies, {
      ...(Platform.OS === 'ios' ? { alertMessage: 'Acercá la etiqueta NFC al iPhone.' } : {}),
    });
    const tag = await nfc.default.getTag();
    if (!tag?.id) throw new Error('No se pudo leer el identificador de la etiqueta');
    return tag.id;
  } finally {
    await cancelNfcRead();
  }
}

export async function cancelNfcRead(): Promise<void> {
  await loadNfc()
    ?.default.cancelTechnologyRequest()
    .catch(() => undefined);
}

export async function openNfcSettings(): Promise<void> {
  if (Platform.OS === 'android') await loadNfc()?.default.goToNfcSetting();
}

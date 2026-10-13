import { Platform } from 'react-native';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';

export async function nfcAvailability(): Promise<'unsupported' | 'disabled' | 'ready'> {
  const supported = await NfcManager.isSupported();
  if (!supported) return 'unsupported';
  await NfcManager.start();
  if (Platform.OS === 'android' && !(await NfcManager.isEnabled())) return 'disabled';
  return 'ready';
}

export async function readFactoryUid(): Promise<string> {
  const technology = Platform.OS === 'android' ? NfcTech.NfcA : NfcTech.Ndef;
  await NfcManager.requestTechnology(
    technology,
    Platform.OS === 'ios' ? { alertMessage: 'Acercá la etiqueta NFC al iPhone.' } : undefined,
  );
  const tag = await NfcManager.getTag();
  if (!tag?.id) throw new Error('No se pudo leer el identificador de la etiqueta');
  return tag.id;
}

export async function cancelNfcRead(): Promise<void> {
  await NfcManager.cancelTechnologyRequest().catch(() => undefined);
}

export async function openNfcSettings(): Promise<void> {
  if (Platform.OS === 'android') await NfcManager.goToNfcSetting();
}

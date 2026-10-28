import { Platform } from 'react-native';
import type * as NfcModule from 'react-native-nfc-manager';
import { nfcTagUidSchema } from '@garita/shared';
import { z } from 'zod';

const tagSchema = z.object({
  id: nfcTagUidSchema,
  ndefMessage: z
    .array(
      z.object({
        type: z.union([z.string(), z.array(z.number())]),
        payload: z.array(z.number().int().min(0).max(255)),
      }),
    )
    .optional(),
});
export interface NfcRead {
  uid: string;
  sdmMessage?: string;
}
let continuousRead = false;

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

function readTag(tag: unknown, nfc: typeof NfcModule): NfcRead {
  const parsed = tagSchema.parse(tag);
  const uri = parsed.ndefMessage?.find(
    (record) =>
      record.type === 'U' ||
      (Array.isArray(record.type) && record.type.length === 1 && record.type[0] === 0x55),
  );
  let sdmMessage: string | undefined;
  if (uri) {
    try {
      const decoded = nfc.Ndef.uri.decodePayload(new Uint8Array(uri.payload));
      if (decoded.startsWith('garita:nfc?') && decoded.length <= 512) sdmMessage = decoded;
    } catch {
      // Ignora payload no legible como URI
    }
  }
  return { uid: parsed.id, sdmMessage };
}

export function readNfcTag(onTag: (tag: NfcRead) => void): Promise<void>;
export function readNfcTag(): Promise<NfcRead>;
export async function readNfcTag(onTag?: (tag: NfcRead) => void): Promise<NfcRead | void> {
  const nfc = loadNfc();
  if (!nfc) throw new Error('NFC no está disponible en este dispositivo');
  if (Platform.OS === 'android' && onTag) {
    continuousRead = true;
    nfc.default.setEventListener(nfc.NfcEvents.DiscoverTag, (tag) => {
      try {
        onTag(readTag(tag, nfc));
      } catch {
        // Ignora etiquetas sin UID o datos nativos inválidos.
      }
    });
    try {
      await nfc.default.registerTagEvent({ isReaderModeEnabled: true });
    } catch (error) {
      await cancelNfcRead();
      throw error;
    }
    return;
  }
  const technologies =
    Platform.OS === 'android'
      ? [nfc.NfcTech.Ndef, nfc.NfcTech.NfcA, nfc.NfcTech.NfcV]
      : [nfc.NfcTech.Ndef, nfc.NfcTech.MifareIOS, nfc.NfcTech.Iso15693IOS];
  try {
    await nfc.default.requestTechnology(technologies, {
      ...(Platform.OS === 'ios' ? { alertMessage: 'Acercá la etiqueta NFC al iPhone.' } : {}),
    });
    const tag = await nfc.default.getTag();
    return readTag(tag, nfc);
  } finally {
    await cancelNfcRead();
  }
}

export function readFactoryUid(onTag: (uid: string) => void): Promise<void>;
export function readFactoryUid(): Promise<string>;
export async function readFactoryUid(onTag?: (uid: string) => void): Promise<string | void> {
  if (onTag) return readNfcTag((tag) => onTag(tag.uid));
  return (await readNfcTag()).uid;
}

export async function cancelNfcRead(): Promise<void> {
  const nfc = loadNfc();
  if (nfc && continuousRead) {
    continuousRead = false;
    nfc.default.setEventListener(nfc.NfcEvents.DiscoverTag, null);
    await nfc.default.unregisterTagEvent().catch(() => undefined);
    return;
  }
  await loadNfc()
    ?.default.cancelTechnologyRequest()
    .catch(() => undefined);
}

export async function openNfcSettings(): Promise<void> {
  if (Platform.OS === 'android') await loadNfc()?.default.goToNfcSetting();
}

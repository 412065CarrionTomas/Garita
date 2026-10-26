import { Platform } from 'react-native';
import type * as NfcModule from 'react-native-nfc-manager';
import { nfcTagUidSchema } from '@garita/shared';
import { z } from 'zod';

const versionSchema = z.string().regex(/^[0-9A-F]{56}$/);
const responseSchema = z.array(z.number().int().min(0).max(255)).min(2).max(256);

function hex(bytes: number[]): string {
  return bytes
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function bytes(value: string): number[] {
  if (!/^(?:[0-9A-F]{2})+$/.test(value)) throw new Error('APDU inválido');
  return value.match(/../g)?.map((pair) => Number.parseInt(pair, 16)) ?? [];
}

export class NotSecureNfcTag extends Error {
  constructor(readonly uid: string) {
    super('Etiqueta NFC básica');
  }
}

export async function withSecureNfcTag<T>(
  action: (tag: {
    uid: string;
    version: string;
    transceive(apdu: string): Promise<string>;
  }) => Promise<T>,
): Promise<T> {
  let nfc: typeof NfcModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- módulo nativo no disponible en Expo Go/web
    nfc = require('react-native-nfc-manager') as typeof NfcModule;
  } catch {
    throw new Error('NFC no está disponible');
  }
  const technology = await nfc.default.requestTechnology(
    Platform.OS === 'android'
      ? [nfc.NfcTech.IsoDep, nfc.NfcTech.NfcA, nfc.NfcTech.NfcV]
      : [nfc.NfcTech.IsoDep, nfc.NfcTech.MifareIOS, nfc.NfcTech.Iso15693IOS],
    {
      ...(Platform.OS === 'ios'
        ? { alertMessage: 'Acercá la etiqueta NTAG 424 DNA al iPhone.' }
        : {}),
    },
  );
  try {
    const nativeTag = await nfc.default.getTag();
    const uid = nfcTagUidSchema.parse(nativeTag?.id);
    if (technology !== nfc.NfcTech.IsoDep) throw new NotSecureNfcTag(uid);
    const transceive = async (command: string) =>
      hex(responseSchema.parse(await nfc.default.isoDepHandler.transceive(bytes(command))));
    if ((await transceive('00A4040C07D276000085010100')) !== '9000') throw new NotSecureNfcTag(uid);
    const parts: string[] = [];
    for (let i = 0; i < 3; i++) {
      const response = await transceive(i === 0 ? '9060000000' : '90AF000000');
      const status = response.slice(-4);
      if (status !== (i === 2 ? '9100' : '91AF')) throw new NotSecureNfcTag(uid);
      parts.push(response.slice(0, -4));
    }
    const version = versionSchema.parse(parts.join(''));
    if (!version.startsWith('0404') || version.slice(14, 18) !== '0404')
      throw new NotSecureNfcTag(uid);
    return await action({ uid, version, transceive });
  } finally {
    await nfc.default.cancelTechnologyRequest().catch(() => undefined);
  }
}

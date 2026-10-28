import { randomBytes, timingSafeEqual } from 'node:crypto';
import { aesBlock, aesCbc, aesCmac, truncateMac } from './crypto';

const ZERO = Buffer.alloc(16);
export const FACTORY_KEY = Buffer.alloc(16);

export interface Ev2State {
  rndA: string;
  rndB: string;
  ti?: string;
}

export function apdu(ins: number, data: Buffer): string {
  if (data.length > 255) throw new Error('APDU demasiado largo');
  return Buffer.concat([Buffer.from([0x90, ins, 0, 0, data.length]), data, Buffer.from([0])])
    .toString('hex')
    .toUpperCase();
}

export function authFirst(keyNumber = 0): string {
  return apdu(0x71, Buffer.from([keyNumber, 0]));
}

export function authContinue(
  response: Buffer,
  key: Buffer,
  rndA = randomBytes(16),
): {
  state: Ev2State;
  command: string;
} {
  if (response.length !== 18 || response.subarray(16).toString('hex') !== '91af')
    throw new Error('Respuesta de autenticación inválida');
  const rndB = aesCbc(key, ZERO, response.subarray(0, 16), true);
  const rotated = Buffer.concat([rndB.subarray(1), rndB.subarray(0, 1)]);
  return {
    state: { rndA: rndA.toString('hex'), rndB: rndB.toString('hex') },
    command: apdu(0xaf, aesCbc(key, ZERO, Buffer.concat([rndA, rotated]))),
  };
}

export function finishAuth(response: Buffer, key: Buffer, state: Ev2State): Ev2State {
  if (response.length !== 34 || response.subarray(32).toString('hex') !== '9100')
    throw new Error('Respuesta final de autenticación inválida');
  const plain = aesCbc(key, ZERO, response.subarray(0, 32), true);
  const rndA = Buffer.from(state.rndA, 'hex');
  const rotated = Buffer.concat([rndA.subarray(1), rndA.subarray(0, 1)]);
  if (!timingSafeEqual(plain.subarray(4, 20), rotated))
    throw new Error('Desafío de autenticación inválido');
  return { ...state, ti: plain.subarray(0, 4).toString('hex') };
}

export function sessionKeys(key: Buffer, state: Ev2State): { enc: Buffer; mac: Buffer } {
  const a = Buffer.from(state.rndA, 'hex');
  const b = Buffer.from(state.rndB, 'hex');
  const mixed = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) mixed[i] = (a[2 + i] ?? 0) ^ (b[i] ?? 0);
  const body = Buffer.concat([a.subarray(0, 2), mixed, b.subarray(6), a.subarray(8)]);
  return {
    enc: aesCmac(key, Buffer.concat([Buffer.from('A55A00010080', 'hex'), body])),
    mac: aesCmac(key, Buffer.concat([Buffer.from('5AA500010080', 'hex'), body])),
  };
}

function counterBytes(counter: number): Buffer {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(counter);
  return bytes;
}

function pad(data: Buffer): Buffer {
  const padded = Buffer.alloc((Math.floor(data.length / 16) + 1) * 16);
  data.copy(padded);
  padded[data.length] = 0x80;
  return padded;
}

export function fullCommand(
  ins: number,
  header: Buffer,
  plain: Buffer,
  counter: number,
  state: Ev2State,
  key: Buffer,
): string {
  if (!state.ti) throw new Error('Sesión no autenticada');
  const { enc, mac } = sessionKeys(key, state);
  const ti = Buffer.from(state.ti, 'hex');
  const ctr = counterBytes(counter);
  const iv = aesBlock(enc, Buffer.concat([Buffer.from('A55A', 'hex'), ti, ctr, Buffer.alloc(8)]));
  const encrypted = aesCbc(enc, iv, pad(plain));
  const signature = truncateMac(
    aesCmac(mac, Buffer.concat([Buffer.from([ins]), ctr, ti, header, encrypted])),
  );
  return apdu(ins, Buffer.concat([header, encrypted, signature]));
}

export function checkFullResponse(
  response: Buffer,
  counter: number,
  state: Ev2State,
  key: Buffer,
  changingAuthenticatedKey = false,
): void {
  if (changingAuthenticatedKey && response.toString('hex') === '9100') return;
  if (!state.ti || response.length !== 10 || response.subarray(8).toString('hex') !== '9100')
    throw new Error('Respuesta segura inválida');
  const { mac } = sessionKeys(key, state);
  const expected = truncateMac(
    aesCmac(
      mac,
      Buffer.concat([Buffer.from([0]), counterBytes(counter + 1), Buffer.from(state.ti, 'hex')]),
    ),
  );
  if (!timingSafeEqual(response.subarray(0, 8), expected))
    throw new Error('MAC de respuesta inválido');
}

function crc32(data: Buffer): Buffer {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(4);
  result.writeUInt32LE((crc ^ 0xffffffff) >>> 0);
  return result;
}

export function changeKey(
  keyNumber: number,
  newKey: Buffer,
  version: number,
  counter: number,
  state: Ev2State,
  authKey: Buffer,
): string {
  const data =
    keyNumber === 0
      ? Buffer.concat([newKey, Buffer.from([version])])
      : Buffer.concat([newKey, Buffer.from([version]), crc32(newKey)]);
  return fullCommand(0xc4, Buffer.from([keyNumber]), data, counter, state, authKey);
}

/** Type 4 URI record, with the two SUN placeholders in ASCII. */
export function ndefTemplate(): { data: Buffer; piccOffset: number; macOffset: number } {
  const uri = 'garita:nfc?e=' + '0'.repeat(32) + '&c=' + '0'.repeat(16);
  const payload = Buffer.concat([Buffer.from([0]), Buffer.from(uri, 'ascii')]);
  const record = Buffer.concat([Buffer.from([0xd1, 0x01, payload.length, 0x55]), payload]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(record.length);
  return {
    data: Buffer.concat([length, record]),
    piccOffset: 2 + 4 + 1 + 'garita:nfc?e='.length,
    macOffset: 2 + 4 + 1 + 'garita:nfc?e='.length + 32 + 3,
  };
}

export function writeNdef(counter: number, state: Ev2State, authKey: Buffer): string {
  const data = ndefTemplate().data;
  const size = Buffer.alloc(3);
  size.writeUIntLE(data.length, 0, 3);
  return fullCommand(
    0x8d,
    Buffer.concat([Buffer.from([2, 0, 0, 0]), size]),
    data,
    counter,
    state,
    authKey,
  );
}

export function changeFileSettings(counter: number, state: Ev2State, authKey: Buffer): string {
  const { piccOffset, macOffset } = ndefTemplate();
  const offset = (value: number) => {
    const bytes = Buffer.alloc(3);
    bytes.writeUIntLE(value, 0, 3);
    return bytes;
  };
  // AN12196 section 5.9: meta key 2, file read MAC key 1, no free counter read.
  const settings = Buffer.concat([
    Buffer.from('4000E0C1F121', 'hex'),
    offset(piccOffset),
    offset(macOffset),
    offset(macOffset),
  ]);
  return fullCommand(0x5f, Buffer.from([2]), settings, counter, state, authKey);
}

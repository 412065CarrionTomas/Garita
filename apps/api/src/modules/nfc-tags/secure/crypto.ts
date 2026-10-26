import { createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';

const ZERO = Buffer.alloc(16);

export function aesBlock(key: Buffer, block: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

export function aesCbc(key: Buffer, iv: Buffer, data: Buffer, decrypt = false): Buffer {
  const cipher = decrypt
    ? createDecipheriv('aes-128-cbc', key, iv)
    : createCipheriv('aes-128-cbc', key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function double(block: Buffer): Buffer {
  const shifted = Buffer.alloc(16);
  let carry = 0;
  for (let i = 15; i >= 0; i--) {
    const byte = block[i];
    shifted[i] = ((byte << 1) & 0xff) | carry;
    carry = byte >>> 7;
  }
  if (carry) shifted[15] ^= 0x87;
  return shifted;
}

/** NIST SP 800-38B, AES-128 CMAC. */
export function aesCmac(key: Buffer, data: Buffer): Buffer {
  const k1 = double(aesBlock(key, ZERO));
  const k2 = double(k1);
  const blocks = Math.max(1, Math.ceil(data.length / 16));
  const last = Buffer.alloc(16);
  const final = data.subarray((blocks - 1) * 16);
  final.copy(last);
  if (final.length === 16) {
    for (let i = 0; i < 16; i++) last[i] ^= k1[i];
  } else {
    last[final.length] = 0x80;
    for (let i = 0; i < 16; i++) last[i] ^= k2[i];
  }
  let state = ZERO;
  for (let block = 0; block < blocks - 1; block++) {
    const input = Buffer.from(data.subarray(block * 16, (block + 1) * 16));
    for (let i = 0; i < 16; i++) input[i] ^= state[i];
    state = aesBlock(key, input);
  }
  for (let i = 0; i < 16; i++) last[i] ^= state[i];
  return aesBlock(key, last);
}

/** NT4H2421Gx section 9.1.3: bytes 1,3,...,15 of the full CMAC. */
export function truncateMac(mac: Buffer): Buffer {
  return Buffer.from(Array.from({ length: 8 }, (_, i) => mac[i * 2 + 1]));
}

/** NIST SP 800-108 counter mode, CMAC PRF; UID, key slot and version bind each key. */
export function deriveTagKey(
  master: Buffer,
  uid: Buffer,
  keyNumber: number,
  version: number,
): Buffer {
  const context = Buffer.concat([uid, Buffer.from([keyNumber, version])]);
  return aesCmac(
    master,
    Buffer.concat([
      Buffer.from('00000001', 'hex'),
      Buffer.from('GARITA-NTAG424-DNA', 'ascii'),
      Buffer.from([0]),
      context,
      Buffer.from('00000080', 'hex'),
    ]),
  );
}

export function verifySun(
  message: string | undefined,
  uid: string,
  metaKey: Buffer,
  fileReadKey: Buffer,
  lastCounter: number | null,
): { result: 'valid' | 'invalid_signature' | 'missing' | 'replayed'; counter?: number } {
  if (!message) return { result: 'missing' };
  const match = /^garita:nfc\?e=([0-9A-Fa-f]{32})&c=([0-9A-Fa-f]{16})$/.exec(message);
  if (!match) return { result: 'invalid_signature' };
  const picc = aesCbc(metaKey, ZERO, Buffer.from(match[1], 'hex'), true);
  if (picc[0] !== 0xc7 || picc.subarray(1, 8).toString('hex').toUpperCase() !== uid)
    return { result: 'invalid_signature' };
  const counterBytes = picc.subarray(8, 11);
  const counter = counterBytes.readUIntLE(0, 3);
  const sessionKey = aesCmac(
    fileReadKey,
    Buffer.concat([Buffer.from('3CC300010080', 'hex'), picc.subarray(1, 11)]),
  );
  const expected = truncateMac(aesCmac(sessionKey, Buffer.alloc(0)));
  const received = Buffer.from(match[2], 'hex');
  if (!timingSafeEqual(expected, received)) return { result: 'invalid_signature' };
  if (lastCounter !== null && counter <= lastCounter) return { result: 'replayed', counter };
  return { result: 'valid', counter };
}

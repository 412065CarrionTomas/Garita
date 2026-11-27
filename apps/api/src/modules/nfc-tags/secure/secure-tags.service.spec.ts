import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { SecureTagsService } from './secure-tags.service';
import { aesCbc, aesCmac, deriveTagKey, truncateMac } from './crypto';
import { authFirst, authContinue, FACTORY_KEY, ndefTemplate } from './ev2';
const uid = '04DE5F1EACC040';
const user: AuthenticatedUser = { userId: 'u', companyId: 'c', role: 'admin', status: 'active' };
const master = Buffer.alloc(16);
const key = (slot: number) => deriveTagKey(master, Buffer.from(uid, 'hex'), slot, 1);
const rndA = '13c5db8a5930439fc3def9a4c675360f';
const rndB = '00112233445566778899aabbccddeeff';
const state = {
  rndA,
  rndB,
  ti: '11223344',
  authKind: 'factory',
  counter: 0,
  oldKeyKind: 'factory',
};
const success = (authKey: Buffer) => {
  const a = Buffer.from(rndA, 'hex');
  return Buffer.concat([
    aesCbc(
      authKey,
      Buffer.alloc(16),
      Buffer.concat([
        Buffer.from('11223344', 'hex'),
        a.subarray(1),
        a.subarray(0, 1),
        Buffer.alloc(12),
      ]),
    ),
    Buffer.from('9100', 'hex'),
  ]).toString('hex');
};
function setup(step = 'auth_1', sessionState: object = {}) {
  const tag = {
    id: 'tag',
    uid,
    companyId: 'c',
    checkpointId: 'point',
    kind: 'secure',
    status: 'removed',
    configurationStatus: 'configured',
    masterKeyVersion: 1,
    lastCounter: 60,
  };
  const session = {
    id: 'session',
    step,
    state: sessionState,
    tagUid: uid,
    checkpointId: 'point',
    createdById: 'u',
    expiresAt: new Date(Date.now() + 60000),
  };
  const db = {
    checkpoint: { findFirst: jest.fn().mockResolvedValue({ id: 'point' }) },
    nfcTag: {
      findFirst: jest.fn().mockResolvedValue(tag),
      update: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    secureTagSession: {
      findFirst: jest.fn().mockResolvedValue(session),
      create: jest.fn().mockResolvedValue({ id: 'session' }),
      updateMany: jest.fn<
        Promise<void>,
        [{ where: { id: string }; data: { step: string; state: Record<string, unknown> } }]
      >(),
      deleteMany: jest.fn(),
    },
  };
  const prisma = {
    tenantPrisma: { ...db, $transaction: (action: (tx: typeof db) => unknown) => action(db) },
    systemPrisma: db,
  } as unknown as PrismaService;
  const config = {
    get: (name: string) => (name === 'NFC_MASTER_KEY' ? master.toString('hex') : 1),
  } as unknown as ConfigService<Env, true>;
  return { db, tag, session, service: new SecureTagsService(prisma, config) };
}
describe('SecureTagsService recovery', () => {
  it.each(['removed', 'active', 'replaced'])(
    'confirma sin reconfigurar una etiqueta configured %s',
    async (status) => {
      const { service, tag, db } = setup();
      tag.status = status;
      expect(
        await service.start(
          'point',
          {
            uid,
            version: '0404' + '00'.repeat(5) + '0404' + '00'.repeat(5) + '04' + '00'.repeat(13),
          },
          user,
        ),
      ).toMatchObject({ complete: true, apdu: null });
      expect(db.nfcTag.update).not.toHaveBeenCalled();
    },
  );
  it('reset obliga a reconfigurar y conserva versión e histórico', async () => {
    const { service, db, tag } = setup();
    await service.reset('tag');
    expect(db.nfcTag.update).toHaveBeenCalledWith({
      where: { id: 'tag' },
      data: { configurationStatus: 'incomplete' },
    });
    tag.configurationStatus = 'incomplete';
    expect(
      await service.start(
        'point',
        {
          uid,
          version: '0404' + '00'.repeat(5) + '0404' + '00'.repeat(5) + '04' + '00'.repeat(13),
        },
        user,
      ),
    ).toMatchObject({ complete: false, apdu: authFirst() });
  });
  it('rechaza otra versión de maestra sin sobrescribirla', async () => {
    const { service, tag, db } = setup();
    tag.masterKeyVersion = 2;
    await expect(
      service.start(
        'point',
        {
          uid,
          version: '0404' + '00'.repeat(5) + '0404' + '00'.repeat(5) + '04' + '00'.repeat(13),
        },
        user,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.nfcTag.update).not.toHaveBeenCalled();
  });
  it('91AF inicia auth_2; 91AE en auth_2 reintenta con derivada', async () => {
    const { service, session, db } = setup();
    const first = Buffer.concat([
      aesCbc(FACTORY_KEY, Buffer.alloc(16), Buffer.from(rndB, 'hex')),
      Buffer.from('91af', 'hex'),
    ]);
    expect(await service.command('session', first.toString('hex'), user)).toMatchObject({
      complete: false,
    });
    expect(db.secureTagSession.updateMany.mock.calls[0]?.[0].data.step).toBe('auth_2');
    session.step = 'auth_2';
    session.state = state;
    expect(await service.command('session', '91AE', user)).toMatchObject({ apdu: authFirst() });
    expect(db.secureTagSession.updateMany.mock.calls[1]?.[0].data).toMatchObject({
      step: 'auth_1',
      state: { authKind: 'derived' },
    });
  });
  it.each(['factory', 'derived'])(
    'después de auth_2 %s reconfigura el NDEF, sin saltar a ready',
    async (kind) => {
      const { service } = setup('auth_2', { ...state, authKind: kind });
      expect(
        await service.command('session', success(kind === 'factory' ? FACTORY_KEY : key(0)), user),
      ).toMatchObject({ complete: false, apdu: expect.stringMatching(/^908D/) as unknown });
    },
  );
  it('escribe el NDEF en modo plano y avanza con el 9100 plano de la etiqueta', async () => {
    const { service, session, db } = setup('auth_2', { ...state, authKind: 'factory' });
    const { apdu } = await service.command('session', success(FACTORY_KEY), user);
    const data = ndefTemplate().data;
    // Plano: Lc = 7 de cabecera + NDEF, sin relleno cifrado ni MAC (si no, la etiqueta da 917E).
    expect(apdu).toBe(
      (
        '908D0000' +
        (7 + data.length).toString(16).padStart(2, '0') +
        '02000000' +
        data.length.toString(16).padStart(2, '0') +
        '0000' +
        data.toString('hex') +
        '00'
      ).toUpperCase(),
    );
    session.step = 'write_ndef';
    session.state = db.secureTagSession.updateMany.mock.calls[0]?.[0].data.state ?? {};
    expect(await service.command('session', '9100', user)).toMatchObject({
      apdu: expect.stringMatching(/^905F/) as unknown,
    });
    expect(db.secureTagSession.updateMany.mock.calls[1]?.[0].data).toMatchObject({
      step: 'file_settings',
      state: { counter: 1 },
    });
    session.step = 'write_ndef';
    await expect(service.command('session', '917E', user)).rejects.toMatchObject({ status: 400 });
  });
  it.each(['key_1', 'key_2', 'key_3', 'key_4'])(
    '911E en %s reautentica antes de reintentar con XOR derivada y contador cero',
    async (step) => {
      const { service, session, db } = setup(step, state);
      expect(await service.command('session', '911E', user)).toMatchObject({ apdu: authFirst() });
      const retry = db.secureTagSession.updateMany.mock.calls[0]?.[0].data.state;
      expect(retry).toMatchObject({ resumeStep: step, oldKeyKind: 'derived', counter: 0 });
      session.step = 'auth_2';
      session.state = { ...state, ...retry };
      expect(await service.command('session', success(FACTORY_KEY), user)).toMatchObject({
        complete: false,
        apdu: expect.stringMatching(/^90C4/) as unknown,
      });
      session.step = step;
      session.state = { ...state, oldKeyKind: 'derived' };
      await expect(service.command('session', '911E', user)).rejects.toMatchObject({ status: 400 });
    },
  );
  it('no reintenta indefinidamente si falla la clave derivada en auth_2', async () => {
    const { service } = setup('auth_2', { ...state, authKind: 'derived' });
    await expect(service.command('session', '91AE', user)).rejects.toMatchObject({ status: 400 });
  });
  it('autentica el desafío derivado usando los vectores de las primitivas EV2', () => {
    const first = Buffer.concat([
      aesCbc(key(0), Buffer.alloc(16), Buffer.from(rndB, 'hex')),
      Buffer.from('91af', 'hex'),
    ]);
    expect(authContinue(first, key(0), Buffer.from(rndA, 'hex')).state.rndB).toBe(rndB);
  });
});
function sun(counter: number) {
  const count = Buffer.alloc(3);
  count.writeUIntLE(counter, 0, 3);
  const content = Buffer.concat([
    Buffer.from([0xc7]),
    Buffer.from(uid, 'hex'),
    count,
    Buffer.alloc(5),
  ]);
  const encrypted = aesCbc(key(2), Buffer.alloc(16), content);
  const sessionKey = aesCmac(
    key(1),
    Buffer.concat([Buffer.from('3cc300010080', 'hex'), content.subarray(1, 11)]),
  );
  return `garita:nfc?e=${encrypted.toString('hex')}&c=${truncateMac(aesCmac(sessionKey, Buffer.alloc(0))).toString('hex')}`;
}
describe('confirm SUN counter', () => {
  it.each([59, 60])('rechaza contador %i sin disminuir el histórico', async (counter) => {
    const { service, db } = setup('ready');
    await expect(
      service.confirm('session', { sdmMessage: sun(counter) }, user),
    ).rejects.toMatchObject({ status: 422 });
    expect(db.nfcTag.updateMany).not.toHaveBeenCalled();
  });
  it('avanza el histórico con comparación atómica del valor previo', async () => {
    const { service, db } = setup('ready');
    await service.confirm('session', { sdmMessage: sun(61) }, user);
    expect(db.nfcTag.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tag', lastCounter: 60 },
        data: expect.objectContaining({ lastCounter: 61 }) as unknown,
      }),
    );
  });
  it('rechaza una carrera que cambió el histórico antes de escribir', async () => {
    const { service, db } = setup('ready');
    db.nfcTag.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.confirm('session', { sdmMessage: sun(61) }, user)).rejects.toMatchObject({
      status: 409,
    });
  });
});

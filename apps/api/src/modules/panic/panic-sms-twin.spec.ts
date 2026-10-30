import { NotFoundException } from '@nestjs/common';
import { type CreatePanicAlertRequest } from '@garita/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { ShiftCredentialPayload } from '../sync/shift-credential.service';
import { PanicService } from './panic.service';
import { completePanicSmsTwin, panicSmsTwinFinder } from './panic-sms-twin';

const now = new Date('2035-01-01T12:00:00Z');
const input: CreatePanicAlertRequest = {
  alertId: 'a1234567-0000-4000-8000-000000000001',
  shiftId: 'shift',
  occurredAtDevice: now.toISOString(),
  location: {
    status: 'ok',
    latitude: -31,
    longitude: -64,
    accuracyMeters: 10,
    simulation: 'unavailable',
    takenAt: now.toISOString(),
  },
};
const credential = {
  companyId: 'company',
  shiftId: 'shift',
  assignmentId: 'assignment',
  userId: 'guard',
} as ShiftCredentialPayload;

describe('SMS twin extension contract for HU-37', () => {
  afterEach(() => jest.restoreAllMocks());
  it('has no SMS arrivals before HU-37', async () => {
    await expect(
      panicSmsTwinFinder.find({ companyId: 'company', shiftId: 'shift', shortId: 'A1234567' }),
    ).resolves.toBeNull();
  });
  it('PanicService.create consults the extension inside its locked transaction', async () => {
    const find = jest.spyOn(panicSmsTwinFinder, 'find');
    const alert = {
      id: input.alertId,
      status: 'active',
      receivedAt: now,
      confirmedAt: null,
      siteId: 'site',
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      panicAlert: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(alert),
      },
      panicAlertEvent: { findUnique: jest.fn().mockResolvedValue(null) },
      shift: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            id: 'shift',
            status: 'in_progress',
            siteId: 'site',
            site: { name: 'Predio' },
            assignments: [{ id: 'assignment' }],
          }),
      },
    };
    const prisma = {
      systemPrisma: {
        $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
      },
    } as unknown as PrismaService;
    const service = new PanicService(
      prisma,
      { now: () => now },
      { notifySiteStaff: jest.fn().mockResolvedValue(undefined) } as never,
      { emitToSite: jest.fn() } as never,
    );
    expect(await service.create(input, credential)).toMatchObject({ alertId: input.alertId });
    expect(find).toHaveBeenCalledWith({
      companyId: 'company',
      shiftId: 'shift',
      shortId: 'A1234567',
    });
    expect(tx.panicAlert.create).toHaveBeenCalledTimes(1);
  });
  it('completes a future SMS twin preserving its origin and first receipt', async () => {
    jest.spyOn(panicSmsTwinFinder, 'find').mockResolvedValue({ id: 'sms-id' });
    const sms = { id: 'sms-id', channel: 'sms', receivedAt: now, accuracyMeters: 20 };
    const update = jest.fn().mockImplementation(async ({ data }) => ({ ...sms, ...data }));
    const tx = {
      panicAlert: { findFirst: jest.fn().mockResolvedValue(sms), update },
    } as unknown as Prisma.TransactionClient;
    const result = await completePanicSmsTwin(tx, input, credential, now);
    expect(result?.alert).toMatchObject({
      id: input.alertId,
      channel: 'sms',
      receivedAt: now,
      accuracyMeters: 10,
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sms-id' },
        data: expect.not.objectContaining({
          channel: expect.anything(),
          receivedAt: expect.anything(),
        }),
      }),
    );
  });
  it('never completes a finder result outside the credential scope', async () => {
    jest.spyOn(panicSmsTwinFinder, 'find').mockResolvedValue({ id: 'foreign' });
    const findFirst = jest.fn().mockResolvedValue(null);
    const update = jest.fn();
    await expect(
      completePanicSmsTwin(
        { panicAlert: { findFirst, update } } as unknown as Prisma.TransactionClient,
        input,
        credential,
        now,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'foreign',
        companyId: 'company',
        shiftId: 'shift',
        assignmentId: 'assignment',
        guardId: 'guard',
        channel: 'sms',
      },
    });
    expect(update).not.toHaveBeenCalled();
  });
});

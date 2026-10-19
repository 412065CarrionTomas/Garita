import { PrismaSyncDeadline } from './prisma-sync-deadline';
import type { PrismaService } from '../prisma/prisma.service';

describe('PrismaSyncDeadline', () => {
  const endsAt = new Date('2030-01-01T15:00:00Z');
  const site = { connectivityType: 'without_signal', minutesToSignal: 180, marginMinutes: 20 };
  const findFirst = jest.fn();
  const service = new PrismaSyncDeadline({
    tenantPrisma: { shift: { findFirst }, site: { findFirst } },
  } as unknown as PrismaService);

  it('uses current site connectivity before start', async () => {
    findFirst.mockResolvedValue({ endsAt, startedAt: null, syncDeadlineAt: null, site });
    expect(await service.deadlineForShift('shift')).toEqual(new Date('2030-01-01T18:20:00Z'));
  });
  it('CA4: preserves the stored deadline after the site changes', async () => {
    findFirst.mockResolvedValue({
      endsAt,
      startedAt: new Date(),
      syncDeadlineAt: new Date('2030-01-01T18:20:00Z'),
      site: { ...site, marginMinutes: 60 },
    });
    expect(await service.deadlineForShift('shift')).toEqual(new Date('2030-01-01T18:20:00Z'));
  });
  it('keeps signal defaults for legacy started shifts', async () => {
    findFirst.mockResolvedValue({ endsAt, startedAt: new Date(), syncDeadlineAt: null, site });
    expect(await service.deadlineForShift('shift')).toEqual(new Date('2030-01-01T15:30:00Z'));
  });
  it('computes the site deadline', async () => {
    findFirst.mockResolvedValue(site);
    expect(await service.deadlineForSite('site', endsAt)).toEqual(new Date('2030-01-01T18:20:00Z'));
  });
  it('does not expose an inaccessible shift or site', async () => {
    findFirst.mockResolvedValue(null);
    await expect(service.deadlineForShift('other')).rejects.toMatchObject({ status: 404 });
    await expect(service.deadlineForSite('other', endsAt)).rejects.toMatchObject({ status: 404 });
  });
});

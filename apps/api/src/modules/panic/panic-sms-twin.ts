import { NotFoundException } from '@nestjs/common';
import { panicShortId, type CreatePanicAlertRequest } from '@garita/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { ShiftCredentialPayload } from '../sync/shift-credential.service';

export interface PanicSmsTwinFinder {
  find(input: {
    companyId: string;
    shiftId: string;
    shortId: string;
  }): Promise<{ id: string } | null>;
}

export const panicSmsTwinFinder: PanicSmsTwinFinder = {
  // TODO(HU-37): query authenticated SMS arrivals when the platform receiver exists.
  find: () => Promise.resolve(null),
};

export async function completePanicSmsTwin(
  tx: Prisma.TransactionClient,
  input: CreatePanicAlertRequest,
  credential: ShiftCredentialPayload,
  now: Date,
) {
  const twin = await panicSmsTwinFinder.find({
    companyId: credential.companyId,
    shiftId: credential.shiftId,
    shortId: panicShortId(input.alertId),
  });
  if (!twin) return null;
  // This transaction is a system transaction; the finder never grants tenant access.
  const sms = await tx.panicAlert.findFirst({
    where: {
      id: twin.id,
      companyId: credential.companyId,
      shiftId: credential.shiftId,
      assignmentId: credential.assignmentId,
      guardId: credential.userId,
      channel: 'sms',
    },
  });
  if (!sms) throw new NotFoundException('Alerta no encontrada');
  const location = input.location;
  const better =
    location.status === 'ok' &&
    location.latitude !== null &&
    location.longitude !== null &&
    location.accuracyMeters !== null &&
    (sms.accuracyMeters === null || location.accuracyMeters < Number(sms.accuracyMeters));
  const alert = await tx.panicAlert.update({
    where: { id: sms.id },
    data: {
      id: input.alertId,
      triggeredAt: new Date(input.clock?.trustedAt ?? input.occurredAtDevice),
      timeStatus: input.clock?.timeStatus,
      ...(better
        ? {
            locationStatus: location.status,
            latitude: location.latitude,
            longitude: location.longitude,
            accuracyMeters: location.accuracyMeters,
          }
        : {}),
      events: { create: { id: input.alertId, type: 'internet_completed', occurredAt: now } },
    },
  });
  return { alert, changed: true as const, siteName: undefined };
}

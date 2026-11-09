import type { FieldRepository, LocalPanicAlert } from '@/lib/db/database';

export async function getRunningPanicShift(repository: FieldRepository) {
  const shift = await repository.getShiftData();
  if (!shift || (await repository.getSyncMeta('shift_closed_done')) === 'true') return null;
  const closed = (await repository.listPendingEvents()).some((event) => {
    const payload = event.payload;
    return (
      event.type === 'shift_close' &&
      typeof payload === 'object' &&
      payload !== null &&
      'shiftId' in payload &&
      payload.shiftId === shift.shift.id
    );
  });
  return closed ? null : shift;
}

export async function isPanicAfterLocalClose(repository: FieldRepository, alert: LocalPanicAlert) {
  return (await repository.listPendingEvents()).some((event) => {
    const payload = event.payload;
    return (
      event.type === 'shift_close' &&
      typeof payload === 'object' &&
      payload !== null &&
      'shiftId' in payload &&
      payload.shiftId === alert.request.shiftId &&
      Date.parse(alert.request.occurredAtDevice) >= Date.parse(event.occurredAtDevice)
    );
  });
}

export async function blockPanicAfterClose(repository: FieldRepository, alert: LocalPanicAlert) {
  await repository.patchPanicAlert(alert.request.alertId, { blockedReason: 'shift_closed' });
  await repository.setSyncMeta(
    `panic_after_close:${alert.request.alertId}`,
    'Turno cerrado localmente',
  );
}

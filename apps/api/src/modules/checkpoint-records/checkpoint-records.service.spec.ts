import { ConflictException, NotFoundException } from '@nestjs/common';
import { CHECKPOINT_RECORD_ERROR_CODES, type CheckpointRecordRequest } from '@garita/shared';
import { CheckpointRecordsService, computeRequestHash } from './checkpoint-records.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { QrService } from '../checkpoints/qr.service';
import type { ShiftExecutionService } from '../shift-execution/shift-execution.service';

const now = new Date('2026-10-13T10:00:00.000Z');

function createSampleRequest(
  overrides: Partial<CheckpointRecordRequest> = {},
): CheckpointRecordRequest {
  return {
    recordId: '11111111-1111-4111-8111-111111111111',
    shiftId: 'shift-1',
    method: 'qr',
    scannedValue: 'GQR1.cp-1.1.valid-sig',
    occurredAtDevice: '2026-10-13T09:30:00.000Z',
    location: {
      status: 'ok',
      latitude: -34.6037,
      longitude: -58.3816,
      accuracyMeters: 5,
      simulation: 'not_simulated',
      takenAt: '2026-10-13T09:30:00.000Z',
    },
    phoneNfc: 'on',
    ...overrides,
  };
}

describe('CheckpointRecordsService', () => {
  const checkpointRecordFindUnique = jest.fn();
  const checkpointRecordFindMany = jest.fn();
  const checkpointRecordCreate = jest.fn();
  const invalidScanAttemptFindUnique = jest.fn();
  const invalidScanAttemptCreate = jest.fn();
  const shiftFindFirst = jest.fn();
  const nfcTagFindFirst = jest.fn();

  const tenantPrisma = {
    checkpointRecord: {
      findUnique: checkpointRecordFindUnique,
      findMany: checkpointRecordFindMany,
      create: checkpointRecordCreate,
    },
    invalidScanAttempt: {
      findUnique: invalidScanAttemptFindUnique,
      create: invalidScanAttemptCreate,
    },
    shift: {
      findFirst: shiftFindFirst,
    },
    nfcTag: {
      findFirst: nfcTagFindFirst,
    },
  };

  const prisma = {
    tenantPrisma,
    systemPrisma: {},
  } as unknown as PrismaService;

  const verifyQrPayload = jest.fn();
  const qrService = { verifyQrPayload } as unknown as QrService;

  const getShiftOfflineData = jest.fn();
  const shiftExecution = { getShiftOfflineData } as unknown as ShiftExecutionService;

  let service: CheckpointRecordsService;

  beforeEach(() => {
    checkpointRecordFindUnique.mockReset().mockResolvedValue(null);
    checkpointRecordFindMany.mockReset().mockResolvedValue([]);
    checkpointRecordCreate
      .mockReset()
      .mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'rec-1', ...args.data }),
      );
    invalidScanAttemptFindUnique.mockReset().mockResolvedValue(null);
    invalidScanAttemptCreate
      .mockReset()
      .mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'att-1', ...args.data }),
      );
    shiftFindFirst.mockReset().mockResolvedValue({
      id: 'shift-1',
      companyId: 'company-1',
      siteId: 'site-1',
      status: 'in_progress',
      closedBy: null,
      closedAt: null,
      assignments: [
        {
          id: 'assign-1',
          guardId: 'guard-1',
          startsAt: new Date('2026-10-13T08:00:00.000Z'),
          endsAt: new Date('2026-10-13T16:00:00.000Z'),
        },
      ],
    });
    nfcTagFindFirst.mockReset().mockResolvedValue(null);

    verifyQrPayload.mockReset().mockResolvedValue({
      valid: true,
      checkpoint: { id: 'cp-1', siteId: 'site-1', qrVersion: 1 },
    });

    getShiftOfflineData.mockReset().mockResolvedValue({
      shift: { id: 'shift-1' },
      rounds: [
        {
          roundId: 'round-1',
          name: 'Ronda Principal',
          checkpointIds: ['cp-1'],
          frequencyMinutes: 120,
          graceMinutes: 15,
        },
      ],
      windows: [
        {
          roundId: 'round-1',
          index: 0,
          startUtc: '2026-10-13T08:00:00.000Z',
          endUtc: '2026-10-13T10:00:00.000Z',
          label: '05:00 - 07:00',
        },
      ],
      checkpoints: [{ id: 'cp-1', name: 'Punto 1', qrVersion: 1 }],
    });

    service = new CheckpointRecordsService(prisma, { now: () => now }, qrService, shiftExecution);
  });

  const guardUser = {
    userId: 'guard-1',
    companyId: 'company-1',
    role: 'guard' as const,
    status: 'active' as const,
  };

  describe('Idempotencia y conflictos', () => {
    it('devuelve la respuesta existente cuando el recordId ya existe con el mismo payload', async () => {
      const request = createSampleRequest();
      const hash = computeRequestHash(request);

      checkpointRecordFindUnique.mockResolvedValue({
        recordId: request.recordId,
        checkpointId: 'cp-1',
        countedFor: [{ roundId: 'round-1', windowIndex: 0, late: false }],
        outOfWindow: false,
        requestHash: hash,
      });

      const result = await service.processRecord(request, guardUser);

      expect(result).toEqual({
        result: 'recorded',
        recordId: request.recordId,
        checkpointId: 'cp-1',
        countedFor: [{ roundId: 'round-1', windowIndex: 0, late: false }],
        outOfWindow: false,
      });
      expect(checkpointRecordCreate).not.toHaveBeenCalled();
    });

    it('devuelve el intento rechazado cuando el recordId ya existe en InvalidScanAttempt con el mismo payload', async () => {
      const request = createSampleRequest();
      const hash = computeRequestHash(request);

      invalidScanAttemptFindUnique.mockResolvedValue({
        recordId: request.recordId,
        reason: 'signature',
        requestHash: hash,
      });

      const result = await service.processRecord(request, guardUser);

      expect(result).toEqual({
        result: 'rejected',
        recordId: request.recordId,
        reason: 'signature',
      });
      expect(invalidScanAttemptCreate).not.toHaveBeenCalled();
    });

    it('lanza 409 RECORD_ID_CONFLICT si el recordId ya existe pero con distinto contenido', async () => {
      const request = createSampleRequest();

      checkpointRecordFindUnique.mockResolvedValue({
        recordId: request.recordId,
        checkpointId: 'cp-1',
        countedFor: [],
        outOfWindow: false,
        requestHash: 'different-hash',
      });

      await expect(service.processRecord(request, guardUser)).rejects.toThrow(ConflictException);
      await expect(service.processRecord(request, guardUser)).rejects.toMatchObject({
        response: { code: CHECKPOINT_RECORD_ERROR_CODES.recordIdConflict },
      });
    });

    it('lanza 409 RECORD_ID_CONFLICT si el intento ya existe pero con distinto contenido', async () => {
      const request = createSampleRequest();

      invalidScanAttemptFindUnique.mockResolvedValue({
        recordId: request.recordId,
        reason: 'malformed',
        requestHash: 'different-hash',
      });

      await expect(service.processRecord(request, guardUser)).rejects.toThrow(ConflictException);
    });
  });

  describe('Validación de turno y asignación', () => {
    it('lanza 404 si el turno no existe', async () => {
      shiftFindFirst.mockResolvedValue(null);
      const request = createSampleRequest();

      await expect(service.processRecord(request, guardUser)).rejects.toThrow(NotFoundException);
    });

    it('lanza 409 SHIFT_NOT_IN_PROGRESS si el turno no está en progreso ni cerrado por admin', async () => {
      shiftFindFirst.mockResolvedValue({
        id: 'shift-1',
        status: 'scheduled',
        assignments: [{ guardId: 'guard-1' }],
      });
      const request = createSampleRequest();

      await expect(service.processRecord(request, guardUser)).rejects.toThrow(ConflictException);
      await expect(service.processRecord(request, guardUser)).rejects.toMatchObject({
        response: { code: CHECKPOINT_RECORD_ERROR_CODES.shiftNotInProgress },
      });
    });

    it('acepta registros si el turno fue cerrado automáticamente (CA9)', async () => {
      shiftFindFirst.mockResolvedValue({
        id: 'shift-1',
        companyId: 'company-1',
        siteId: 'site-1',
        status: 'auto_closed',
        closedBy: 'system',
        closedAt: new Date('2026-10-13T12:00:00.000Z'),
        assignments: [
          {
            id: 'assign-1',
            guardId: 'guard-1',
            startsAt: new Date('2026-10-13T08:00:00.000Z'),
            endsAt: new Date('2026-10-13T12:00:00.000Z'),
          },
        ],
      });
      verifyQrPayload.mockResolvedValue({
        valid: true,
        checkpoint: { id: 'cp-1', siteId: 'site-1', qrVersion: 1 },
      });
      getShiftOfflineData.mockResolvedValue({
        rounds: [{ roundId: 'round-1', checkpointIds: ['cp-1'] }],
        windows: [
          {
            roundId: 'round-1',
            index: 0,
            startUtc: '2026-10-13T08:00:00.000Z',
            endUtc: '2026-10-13T12:00:00.000Z',
            label: '08:00 - 12:00',
          },
        ],
      });

      const request = createSampleRequest({
        occurredAtDevice: '2026-10-13T10:00:00.000Z',
      });
      const result = await service.processRecord(request, guardUser);
      expect(result.result).toBe('recorded');
      const [call] = checkpointRecordCreate.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(call.data.countsForCompliance).toBe(true);
    });

    it('lanza 409 SHIFT_NOT_IN_PROGRESS si la asignación vigente es de otro vigilador', async () => {
      shiftFindFirst.mockResolvedValue({
        id: 'shift-1',
        status: 'in_progress',
        assignments: [{ guardId: 'other-guard' }],
      });
      const request = createSampleRequest();

      await expect(service.processRecord(request, guardUser)).rejects.toThrow(ConflictException);
      await expect(service.processRecord(request, guardUser)).rejects.toMatchObject({
        response: { code: CHECKPOINT_RECORD_ERROR_CODES.shiftNotInProgress },
      });
    });

    it('guarda con countsForCompliance = false si el evento es posterior a un cierre por administrador', async () => {
      shiftFindFirst.mockResolvedValue({
        id: 'shift-1',
        companyId: 'company-1',
        siteId: 'site-1',
        status: 'closed',
        closedBy: 'admin',
        closedAt: new Date('2026-10-13T09:00:00.000Z'),
        assignments: [
          {
            id: 'assign-1',
            guardId: 'guard-1',
            startsAt: new Date('2026-10-13T08:00:00.000Z'),
            endsAt: new Date('2026-10-13T16:00:00.000Z'),
          },
        ],
      });
      const request = createSampleRequest({ occurredAtDevice: '2026-10-13T09:30:00.000Z' });

      await service.processRecord(request, guardUser);

      expect(checkpointRecordCreate).toHaveBeenCalledTimes(1);
      const callData = (
        checkpointRecordCreate.mock.calls[0] as [{ data: Record<string, unknown> }]
      )[0].data;
      expect(callData).toMatchObject({ countsForCompliance: false });
    });

    it('guarda con countsForCompliance = true si el evento es anterior al cierre por administrador', async () => {
      shiftFindFirst.mockResolvedValue({
        id: 'shift-1',
        companyId: 'company-1',
        siteId: 'site-1',
        status: 'closed',
        closedBy: 'admin',
        closedAt: new Date('2026-10-13T09:50:00.000Z'),
        assignments: [
          {
            id: 'assign-1',
            guardId: 'guard-1',
            startsAt: new Date('2026-10-13T08:00:00.000Z'),
            endsAt: new Date('2026-10-13T16:00:00.000Z'),
          },
        ],
      });
      const request = createSampleRequest({ occurredAtDevice: '2026-10-13T09:30:00.000Z' });

      await service.processRecord(request, guardUser);

      expect(checkpointRecordCreate).toHaveBeenCalledTimes(1);
      const callData = (
        checkpointRecordCreate.mock.calls[0] as [{ data: Record<string, unknown> }]
      )[0].data;
      expect(callData).toMatchObject({ countsForCompliance: true });
    });
  });

  describe('Verificación de QR e intentos inválidos', () => {
    it('guarda intento rechazado y devuelve rejected para QR mal formado', async () => {
      verifyQrPayload.mockResolvedValue({ valid: false, reason: 'malformed' });
      const request = createSampleRequest();

      const result = await service.processRecord(request, guardUser);

      expect(result).toEqual({
        result: 'rejected',
        recordId: request.recordId,
        reason: 'malformed',
      });
      expect(invalidScanAttemptCreate).toHaveBeenCalledTimes(1);
      const callData = (
        invalidScanAttemptCreate.mock.calls[0] as [{ data: Record<string, unknown> }]
      )[0].data;
      expect(callData).toMatchObject({ reason: 'malformed', highlighted: false });
    });

    it('guarda intento rechazado y devuelve rejected para firma inválida', async () => {
      verifyQrPayload.mockResolvedValue({ valid: false, reason: 'signature' });
      const request = createSampleRequest();

      const result = await service.processRecord(request, guardUser);

      expect(result).toEqual({
        result: 'rejected',
        recordId: request.recordId,
        reason: 'signature',
      });
      expect(invalidScanAttemptCreate).toHaveBeenCalledTimes(1);
      const callData = (
        invalidScanAttemptCreate.mock.calls[0] as [{ data: Record<string, unknown> }]
      )[0].data;
      expect(callData).toMatchObject({ reason: 'signature', highlighted: false });
    });

    it('destaca (highlighted=true) intentos de versión regenerada', async () => {
      verifyQrPayload.mockResolvedValue({ valid: false, reason: 'outdated' });
      const request = createSampleRequest();

      const result = await service.processRecord(request, guardUser);

      expect(result).toEqual({
        result: 'rejected',
        recordId: request.recordId,
        reason: 'outdated_version',
      });
      expect(invalidScanAttemptCreate).toHaveBeenCalledTimes(1);
      const callData = (
        invalidScanAttemptCreate.mock.calls[0] as [{ data: Record<string, unknown> }]
      )[0].data;
      expect(callData).toMatchObject({ reason: 'outdated_version', highlighted: true });
    });

    it('guarda intento rechazado para QR de otro predio', async () => {
      verifyQrPayload.mockResolvedValue({
        valid: true,
        checkpoint: { id: 'cp-other', siteId: 'other-site-id', qrVersion: 1 },
      });
      const request = createSampleRequest();

      const result = await service.processRecord(request, guardUser);

      expect(result).toEqual({
        result: 'rejected',
        recordId: request.recordId,
        reason: 'other_site',
      });
      expect(invalidScanAttemptCreate).toHaveBeenCalledTimes(1);
      const callData = (
        invalidScanAttemptCreate.mock.calls[0] as [{ data: Record<string, unknown> }]
      )[0].data;
      expect(callData).toMatchObject({ reason: 'other_site', highlighted: false });
    });
  });

  describe('Soporte de NFC', () => {
    it('rechaza con tag_not_associated si el uid NFC no existe', async () => {
      nfcTagFindFirst.mockResolvedValue(null);
      const request = createSampleRequest({ method: 'nfc', scannedValue: '04:A1:B2:C3:D4:E5:F6' });

      const result = await service.processRecord(request, guardUser);

      expect(result).toEqual({
        result: 'rejected',
        recordId: request.recordId,
        reason: 'tag_not_associated',
      });
    });

    it('rechaza con tag_replaced si la etiqueta fue reemplazada', async () => {
      nfcTagFindFirst.mockResolvedValue({
        status: 'replaced',
        checkpoint: { siteId: 'site-1', status: 'active' },
      });
      const request = createSampleRequest({ method: 'nfc', scannedValue: '04:A1:B2:C3:D4:E5:F6' });

      const result = await service.processRecord(request, guardUser);

      expect(result).toEqual({
        result: 'rejected',
        recordId: request.recordId,
        reason: 'tag_replaced',
      });
    });

    it('rechaza con other_site si la etiqueta NFC pertenece a un punto de otro predio', async () => {
      nfcTagFindFirst.mockResolvedValue({
        status: 'active',
        checkpoint: { siteId: 'other-site', status: 'active' },
      });
      const request = createSampleRequest({ method: 'nfc', scannedValue: '04:A1:B2:C3:D4:E5:F6' });

      const result = await service.processRecord(request, guardUser);

      expect(result).toEqual({
        result: 'rejected',
        recordId: request.recordId,
        reason: 'other_site',
      });
    });
  });

  describe('Imputación a ventanas y resultados', () => {
    it('guarda CheckpointRecord y devuelve recorded cuando cuenta para una ventana', async () => {
      const request = createSampleRequest({ occurredAtDevice: '2026-10-13T08:30:00.000Z' });

      const result = await service.processRecord(request, guardUser);

      expect(result).toEqual({
        result: 'recorded',
        recordId: request.recordId,
        checkpointId: 'cp-1',
        countedFor: [{ roundId: 'round-1', windowIndex: 0, late: false }],
        outOfWindow: false,
      });
      expect(checkpointRecordCreate).toHaveBeenCalledTimes(1);
      const callData = (
        checkpointRecordCreate.mock.calls[0] as [{ data: Record<string, unknown> }]
      )[0].data;
      expect(callData).toMatchObject({ recordId: request.recordId, outOfWindow: false });
    });

    it('guarda con outOfWindow = true y countedFor vacío cuando cae fuera de toda ventana y gracia', async () => {
      const request = createSampleRequest({ occurredAtDevice: '2026-10-13T07:00:00.000Z' });

      const result = await service.processRecord(request, guardUser);

      expect(result).toEqual({
        result: 'recorded',
        recordId: request.recordId,
        checkpointId: 'cp-1',
        countedFor: [],
        outOfWindow: true,
      });
      expect(checkpointRecordCreate).toHaveBeenCalledTimes(1);
      const callData = (
        checkpointRecordCreate.mock.calls[0] as [{ data: Record<string, unknown> }]
      )[0].data;
      expect(callData).toMatchObject({ outOfWindow: true, countedFor: [] });
    });

    it('no genera registro y devuelve not_generated already_recorded si ya fue registrado en la ventana', async () => {
      checkpointRecordFindMany.mockResolvedValue([
        {
          checkpointId: 'cp-1',
          occurredAtDevice: new Date('2026-10-13T08:15:00.000Z'),
          countedFor: [{ roundId: 'round-1', windowIndex: 0 }],
        },
      ]);
      const request = createSampleRequest({ occurredAtDevice: '2026-10-13T09:30:00.000Z' });

      const result = await service.processRecord(request, guardUser);

      expect(result).toEqual({
        result: 'not_generated',
        recordId: request.recordId,
        cause: 'already_recorded',
        retryAfterUtc: null,
      });
      expect(checkpointRecordCreate).not.toHaveBeenCalled();
    });

    it('no genera registro y devuelve too_soon con retryAfterUtc si se escanea antes del tiempo mínimo', async () => {
      getShiftOfflineData.mockResolvedValue({
        shift: { id: 'shift-1' },
        rounds: [
          {
            roundId: 'round-1',
            name: 'Ronda Principal',
            checkpointIds: ['cp-1'],
            frequencyMinutes: 120,
            graceMinutes: 15,
          },
        ],
        windows: [
          {
            roundId: 'round-1',
            index: 0,
            startUtc: '2026-10-13T06:00:00.000Z',
            endUtc: '2026-10-13T08:00:00.000Z',
            label: '03:00 - 05:00',
          },
          {
            roundId: 'round-1',
            index: 1,
            startUtc: '2026-10-13T08:00:00.000Z',
            endUtc: '2026-10-13T10:00:00.000Z',
            label: '05:00 - 07:00',
          },
        ],
        checkpoints: [{ id: 'cp-1', name: 'Punto 1', qrVersion: 1 }],
      });

      checkpointRecordFindMany.mockResolvedValue([
        {
          checkpointId: 'cp-1',
          occurredAtDevice: new Date('2026-10-13T08:10:00.000Z'),
          countedFor: [{ roundId: 'round-1', windowIndex: 0, late: true }],
        },
      ]);

      const request = createSampleRequest({ occurredAtDevice: '2026-10-13T08:12:00.000Z' });

      const result = await service.processRecord(request, guardUser);

      expect(result).toEqual({
        result: 'not_generated',
        recordId: request.recordId,
        cause: 'too_soon',
        retryAfterUtc: '2026-10-13T09:10:00.000Z',
      });
      expect(checkpointRecordCreate).not.toHaveBeenCalled();
    });
  });
});

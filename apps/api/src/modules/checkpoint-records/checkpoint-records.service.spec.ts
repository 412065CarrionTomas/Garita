import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  CHECKPOINT_RECORD_ERROR_CODES,
  type CheckpointRecordRequest,
  type ShiftOfflineData,
} from '@garita/shared';
import {
  CheckpointRecordsService,
  computeRequestHash,
  type CheckpointRecordBatchContext,
} from './checkpoint-records.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { QrService } from '../checkpoints/qr.service';
import type { ShiftExecutionService } from '../shift-execution/shift-execution.service';
import type { MarcasService } from '../marcas/marcas.service';

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

  const evaluateRecord = jest.fn().mockResolvedValue(undefined);
  const marcasService = { evaluateRecord } as unknown as MarcasService;

  let service: CheckpointRecordsService;

  beforeEach(() => {
    evaluateRecord.mockReset().mockResolvedValue(undefined);
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

    service = new CheckpointRecordsService(
      prisma,
      { now: () => now },
      qrService,
      shiftExecution,
      marcasService,
    );
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

    it('rechaza con tag_not_associated si la etiqueta NFC pertenece a un punto de otro predio', async () => {
      nfcTagFindFirst.mockResolvedValue({
        status: 'active',
        checkpoint: { siteId: 'other-site', status: 'active' },
      });
      const request = createSampleRequest({ method: 'nfc', scannedValue: '04:A1:B2:C3:D4:E5:F6' });

      const result = await service.processRecord(request, guardUser);

      expect(result).toEqual({
        result: 'rejected',
        recordId: request.recordId,
        reason: 'tag_not_associated',
      });
    });

    it('guarda un UID malformado como intento en lugar de lanzar un error', async () => {
      const result = await service.processRecord(
        createSampleRequest({ method: 'nfc', scannedValue: 'invalid' }),
        guardUser,
      );
      expect(result).toMatchObject({ result: 'rejected', reason: 'tag_not_associated' });
      expect(invalidScanAttemptCreate).toHaveBeenCalledTimes(1);
      expect(checkpointRecordCreate).not.toHaveBeenCalled();
    });

    it('normaliza UID válido y aplica imputación y marcas como QR', async () => {
      nfcTagFindFirst.mockResolvedValue({
        status: 'active',
        checkpoint: { id: 'cp-1', siteId: 'site-1', status: 'active' },
      });
      const result = await service.processRecord(
        createSampleRequest({ method: 'nfc', scannedValue: '04:aa:bb:cc' }),
        guardUser,
      );
      expect(nfcTagFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { uid: '04AABBCC' } }),
      );
      expect(result).toMatchObject({ result: 'recorded', checkpointId: 'cp-1' });
      expect(evaluateRecord).toHaveBeenCalledWith(expect.objectContaining({ method: 'nfc' }));
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

  describe('Gancho de evaluación de marcas (HU-15)', () => {
    it('llama al evaluador de marcas al guardar un registro válido', async () => {
      const request = createSampleRequest();
      const result = await service.processRecord(request, guardUser);

      expect(result.result).toBe('recorded');
      expect(checkpointRecordCreate).toHaveBeenCalled();
      expect(evaluateRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          recordId: request.recordId,
          shiftId: request.shiftId,
        }),
      );
    });

    it('si el evaluador de marcas lanza un error, el registro se guarda igual sin fallar (CA5)', async () => {
      evaluateRecord.mockRejectedValue(new Error('Fallo simulado en evaluador'));
      const request = createSampleRequest();

      const result = await service.processRecord(request, guardUser);

      expect(result.result).toBe('recorded');
      expect(checkpointRecordCreate).toHaveBeenCalled();
    });
  });
  it('excludes invalidated records from imputation history', async () => {
    await service.processRecord(createSampleRequest(), guardUser);
    expect(checkpointRecordFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shiftId: 'shift-1', invalidatedAt: null },
      }),
    );
  });

  it('does not pollute batch history when persistence fails', async () => {
    const previousRecords: {
      checkpointId: string;
      occurredAtUtc: string;
      countedFor: { roundId: string; windowIndex: number }[];
    }[] = [];
    checkpointRecordCreate.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      service.processRecord(createSampleRequest(), guardUser, { previousRecords }),
    ).rejects.toThrow('database unavailable');
    expect(previousRecords).toEqual([]);
  });

  it.each([
    ['2026-10-13T09:30:00.000Z', true],
    ['2026-10-13T10:30:00.000Z', false],
  ])(
    'accepts the outgoing credential assignment at %s after administrative coverage',
    async (occurredAtDevice, countsForCompliance) => {
      shiftFindFirst.mockResolvedValue({
        id: 'shift-1',
        companyId: 'company-1',
        siteId: 'site-1',
        status: 'scheduled',
        closedBy: null,
        closedAt: null,
        events: [{ type: 'admin_close', occurredAt: new Date('2026-10-13T10:00:00.000Z') }],
        assignments: [
          {
            id: 'old-assignment',
            guardId: 'guard-1',
            startsAt: new Date('2026-10-13T08:00:00Z'),
            endsAt: new Date('2026-10-13T16:00:00Z'),
          },
        ],
      });
      const result = await service.processRecord(
        createSampleRequest({ occurredAtDevice }),
        guardUser,
        { credentialAssignmentId: 'old-assignment' },
      );
      expect(result.result).toBe('recorded');
      expect((checkpointRecordCreate.mock.calls as unknown[][])[0]?.[0]).toMatchObject({
        data: { assignmentId: 'old-assignment', countsForCompliance },
      });
      expect((shiftFindFirst.mock.calls as unknown[][])[0]?.[0]).toMatchObject({
        include: { assignments: { where: { id: 'old-assignment', guardId: 'guard-1' } } },
      });
    },
  );
  it.each(['2026-10-13T07:59:59.000Z', '2026-10-13T16:00:01.000Z'])(
    'rejects a credential record outside its assignment at %s',
    async (occurredAtDevice) => {
      await expect(
        service.processRecord(createSampleRequest({ occurredAtDevice }), guardUser, {
          credentialAssignmentId: 'assign-1',
        }),
      ).rejects.toThrow(ConflictException);
      expect(checkpointRecordCreate).not.toHaveBeenCalled();
    },
  );

  it('imputes against the original assignment start snapshot after a replacement starts', async () => {
    const original = (await getShiftOfflineData()) as ShiftOfflineData;
    original.shift = {
      id: 'shift-1',
      siteId: 'site-1',
      siteName: 'Predio',
      startsAt: '2026-10-13T08:00:00.000Z',
      endsAt: '2026-10-13T16:00:00.000Z',
      timezone: 'UTC',
      assignmentId: 'assign-1',
    };
    original.serverTime = { serverNowUtc: '2026-10-13T08:00:00.000Z' };
    original.rounds = [
      {
        roundId: 'round-1',
        roundVersionId: 'old-version',
        name: 'Ronda',
        checkpointIds: ['cp-1'],
        frequencyMinutes: 120,
        graceMinutes: 15,
        windowStartLocal: '08:00',
        windowEndLocal: '16:00',
      },
    ];
    original.checkpoints = [
      { id: 'cp-1', name: 'Punto 1', qrVersion: 1, nfcUid: null, isIndoor: false },
    ];
    const shift = (await shiftFindFirst()) as NonNullable<CheckpointRecordBatchContext['shift']>;
    shift.events = [
      { type: 'start', occurredAt: new Date('2026-10-13T08:00:00Z'), response: { data: original } },
    ];
    getShiftOfflineData.mockResolvedValue({ ...original, windows: [] });
    expect(
      await service.processRecord(createSampleRequest(), guardUser, {
        credentialAssignmentId: 'assign-1',
        shift,
      }),
    ).toMatchObject({
      result: 'recorded',
      countedFor: [{ roundId: 'round-1', windowIndex: 0, late: false }],
    });
  });
});

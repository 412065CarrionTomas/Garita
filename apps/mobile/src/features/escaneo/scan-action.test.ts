import type {
  CheckpointRecordRequest,
  CheckpointRecordResponse,
  PendingFieldEvent,
  ShiftOfflineData,
} from '@garita/shared';
import type { LocalCheckpointRecord } from '@/lib/db/database';
import { processScan, resetScanActionsForTesting, setScanActionsForTesting } from './scan-action';

jest.mock('@/lib/nfc', () => ({
  nfcAvailability: jest.fn(async () => 'ready'),
}));

// Shift with rounds:
// 1. "Perimetral": 22:00 to 06:00, 2-hour windows (120 min), grace 15 min, points: ['cp-porton', 'cp-galpon']
// 2. "Interna": 22:00 to 06:00, 2-hour windows (120 min), grace 15 min, points: ['cp-galpon', 'cp-oficina']
const shiftData: ShiftOfflineData = {
  shift: {
    id: 'shift-deposito',
    siteId: 'site-deposito',
    siteName: 'Depósito Ruta 9',
    startsAt: '2026-10-14T22:00:00.000Z',
    endsAt: '2026-10-15T06:00:00.000Z',
    timezone: 'UTC',
    assignmentId: 'assign-1',
  },
  rounds: [
    {
      roundId: 'round-perimetral',
      roundVersionId: 'v-perimetral',
      name: 'Perimetral',
      frequencyMinutes: 120,
      windowStartLocal: '22:00',
      windowEndLocal: '06:00',
      graceMinutes: 15,
      checkpointIds: ['cp-porton', 'cp-galpon'],
    },
    {
      roundId: 'round-interna',
      roundVersionId: 'v-interna',
      name: 'Interna',
      frequencyMinutes: 120,
      windowStartLocal: '22:00',
      windowEndLocal: '06:00',
      graceMinutes: 15,
      checkpointIds: ['cp-galpon', 'cp-oficina'],
    },
  ],
  windows: [
    // Window 0: 22:00–24:00 (00:00), grace until 00:15
    {
      roundId: 'round-perimetral',
      index: 0,
      startUtc: '2026-10-14T22:00:00.000Z',
      endUtc: '2026-10-15T00:00:00.000Z',
      label: '22:00–00:00',
    },
    // Window 1: 00:00–02:00, grace until 02:15
    {
      roundId: 'round-perimetral',
      index: 1,
      startUtc: '2026-10-15T00:00:00.000Z',
      endUtc: '2026-10-15T02:00:00.000Z',
      label: '00:00–02:00',
    },
    // Interna Window 0: 22:00–24:00
    {
      roundId: 'round-interna',
      index: 0,
      startUtc: '2026-10-14T22:00:00.000Z',
      endUtc: '2026-10-15T00:00:00.000Z',
      label: '22:00–00:00',
    },
  ],
  checkpoints: [
    {
      id: 'cp-porton',
      name: 'Portón trasero',
      qrVersion: 1,
      nfcUid: null,
      isIndoor: false,
    },
    {
      id: 'cp-galpon',
      name: 'Galpón 1',
      qrVersion: 1,
      nfcUid: null,
      isIndoor: true,
    },
    {
      id: 'cp-oficina',
      name: 'Oficina guardia',
      qrVersion: 1,
      nfcUid: null,
      isIndoor: true,
    },
  ],
  serverTime: { serverNowUtc: '2026-10-14T22:00:00.000Z' },
};

function createMockRepository() {
  const pendingEvents: PendingFieldEvent[] = [];
  const checkpointRecords: LocalCheckpointRecord[] = [];
  const sentEvents = new Set<string>();

  return {
    pendingEvents,
    checkpointRecords,
    sentEvents,
    saveShiftData: jest.fn(async () => shiftData),
    getShiftData: jest.fn(async () => shiftData),
    clearShiftData: jest.fn(async () => undefined),
    addPendingEvent: jest.fn(async (event: PendingFieldEvent) => {
      pendingEvents.push(event);
    }),
    listPendingEvents: jest.fn(async () => pendingEvents.filter((e) => !sentEvents.has(e.id))),
    markPendingEventSent: jest.fn(async (id: string) => {
      sentEvents.add(id);
    }),
    saveCheckpointRecord: jest.fn(async (record: LocalCheckpointRecord) => {
      const idx = checkpointRecords.findIndex((r) => r.recordId === record.recordId);
      if (idx >= 0) checkpointRecords[idx] = record;
      else checkpointRecords.push(record);
      return record;
    }),
    listCheckpointRecords: jest.fn(async (shiftId?: string) =>
      shiftId ? checkpointRecords.filter((r) => r.shiftId === shiftId) : [...checkpointRecords],
    ),
    updateCheckpointRecordServerResult: jest.fn(
      async (recordId: string, result: 'recorded' | 'rejected', reason?: string | null) => {
        const found = checkpointRecords.find((r) => r.recordId === recordId);
        if (found) {
          found.serverResult = result;
          found.serverReason = reason ?? null;
        }
      },
    ),
  };
}

describe('scan-action: processScan', () => {
  let mockRepo: ReturnType<typeof createMockRepository>;
  let sendMock: jest.Mock<Promise<CheckpointRecordResponse>, [CheckpointRecordRequest]>;
  let feedbackMock: jest.Mock<Promise<void>, []>;

  beforeEach(() => {
    mockRepo = createMockRepository();
    sendMock = jest.fn(async (req) => ({
      result: 'recorded' as const,
      recordId: req.recordId,
      checkpointId: 'cp-porton',
      countedFor: [{ roundId: 'round-perimetral', windowIndex: 0, late: false }],
      outOfWindow: false,
    }));
    feedbackMock = jest.fn(async () => undefined);

    setScanActionsForTesting({
      now: () => new Date('2026-10-14T22:30:00.000Z'),
      online: async () => true,
      permissions: async () => 'ok',
      location: async () => ({
        status: 'ok',
        latitude: -34.6,
        longitude: -58.4,
        accuracyMeters: 10,
        simulation: 'not_simulated',
        takenAt: '2026-10-14T22:30:00.000Z',
      }),
      nfc: async () => 'on',
      uuid: () => '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
      send: sendMock,
      repository: async () => mockRepo as never,
      feedback: feedbackMock,
    });
  });

  afterEach(() => {
    resetScanActionsForTesting();
  });

  // CA1, BDD 1
  it('CA1 & BDD 1: valid QR scan confirms immediately with vibration/sound and "{Punto} registrado"', async () => {
    const result = await processScan(
      'GQR1.cp-porton.1.validSignature123456789012345678901234567890',
      shiftData,
    );

    expect(result).toEqual({
      status: 'counted',
      message: 'Portón trasero registrado',
      checkpointId: 'cp-porton',
      checkpointName: 'Portón trasero',
      recordId: '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
      countedFor: [{ roundId: 'round-perimetral', windowIndex: 0, late: false }],
    });
    expect(feedbackMock).toHaveBeenCalledTimes(1);

    // Verified saved as pending event
    expect(mockRepo.addPendingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
        type: 'checkpoint_record',
        payload: expect.objectContaining({
          method: 'qr',
          shiftId: 'shift-deposito',
          location: expect.objectContaining({ status: 'ok' }),
        }),
      }),
    );

    // Verified saved in local checkpoint records
    expect(mockRepo.saveCheckpointRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
        checkpointName: 'Portón trasero',
        outOfWindow: false,
      }),
    );

    // Verified sent and marked
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(mockRepo.markPendingEventSent).toHaveBeenCalledWith(
      '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
    );
    expect(mockRepo.updateCheckpointRecordServerResult).toHaveBeenCalledWith(
      '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
      'recorded',
    );
  });

  // CA2, BDD 2
  it('CA2 & BDD 2: QR of another site is saved as checkpoint_record and informs user', async () => {
    const result = await processScan('GQR1.cp-planta-norte.1.sig123', shiftData);

    expect(result).toEqual({
      status: 'invalid_attempt',
      reason: 'other_site',
      message: 'Este punto no pertenece a tu turno',
      recordId: '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
    });
    expect(feedbackMock).not.toHaveBeenCalled();
    expect(mockRepo.saveCheckpointRecord).not.toHaveBeenCalled();
    expect(mockRepo.addPendingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'checkpoint_record',
        payload: expect.objectContaining({
          scannedValue: 'GQR1.cp-planta-norte.1.sig123',
        }),
      }),
    );
  });

  it('CA2: malformed QR saves checkpoint_record and informs user', async () => {
    const result = await processScan('CORRUPTED_CODE', shiftData);

    expect(result).toEqual({
      status: 'invalid_attempt',
      reason: 'malformed',
      message: 'Código QR no válido',
      recordId: '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
    });
    expect(mockRepo.addPendingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'checkpoint_record',
        payload: expect.objectContaining({ scannedValue: 'CORRUPTED_CODE' }),
      }),
    );
  });

  it('CA2: outdated QR version saves checkpoint_record and informs user', async () => {
    // cp-porton has qrVersion 1, scanned version 2
    const result = await processScan('GQR1.cp-porton.2.sig123', shiftData);

    expect(result).toEqual({
      status: 'invalid_attempt',
      reason: 'outdated_version',
      message: 'Código QR desactualizado',
      recordId: '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
    });
    expect(mockRepo.addPendingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'checkpoint_record',
      }),
    );
  });

  // CA3, BDD 3
  it('CA3 & BDD 3: no location in 5 seconds results in unverifiable location', async () => {
    setScanActionsForTesting({
      location: async () => ({
        status: 'unverifiable',
        latitude: null,
        longitude: null,
        accuracyMeters: null,
        simulation: 'unavailable',
        takenAt: null,
      }),
    });

    const result = await processScan(
      'GQR1.cp-porton.1.sig1234567890123456789012345678901234567890',
      shiftData,
    );
    expect(result.status).toBe('counted');
    expect(mockRepo.addPendingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          location: expect.objectContaining({ status: 'unverifiable' }),
        }),
      }),
    );
  });

  it('CA3: location disabled / permissions missing results in disabled location', async () => {
    setScanActionsForTesting({
      location: async () => ({
        status: 'disabled',
        latitude: null,
        longitude: null,
        accuracyMeters: null,
        simulation: 'unavailable',
        takenAt: null,
      }),
    });

    const result = await processScan(
      'GQR1.cp-porton.1.sig1234567890123456789012345678901234567890',
      shiftData,
    );
    expect(result.status).toBe('counted');
    expect(mockRepo.addPendingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          location: expect.objectContaining({ status: 'disabled' }),
        }),
      }),
    );
  });

  // CA4, BDD 4
  it('CA4 & BDD 4: point already recorded in current window does not generate another record', async () => {
    // Previous record exists for cp-porton in window 0
    mockRepo.checkpointRecords.push({
      recordId: 'rec-prev-1',
      shiftId: 'shift-deposito',
      checkpointId: 'cp-porton',
      checkpointName: 'Portón trasero',
      occurredAtUtc: '2026-10-14T22:15:00.000Z',
      countedFor: [{ roundId: 'round-perimetral', windowIndex: 0, late: false }],
      outOfWindow: false,
      serverResult: 'recorded',
      serverReason: null,
      createdAt: '2026-10-14T22:15:01.000Z',
    });

    // Pedro scans again at 23:30 (inside window 0, but half duration is 60 min so minimum time passed, yet window already has cp-porton)
    setScanActionsForTesting({ now: () => new Date('2026-10-14T23:30:00.000Z') });

    const result = await processScan(
      'GQR1.cp-porton.1.sig1234567890123456789012345678901234567890',
      shiftData,
    );

    expect(result).toEqual({
      status: 'already_recorded',
      message: 'Este punto ya está registrado en esta vuelta',
      checkpointId: 'cp-porton',
      checkpointName: 'Portón trasero',
    });
    // No record generated
    expect(mockRepo.addPendingEvent).not.toHaveBeenCalled();
    expect(mockRepo.saveCheckpointRecord).not.toHaveBeenCalled();
  });

  // CA5
  it('CA5: scan outside of any window and grace is saved as out_of_window', async () => {
    // Scan at 04:00 (outside window 0 and 1)
    setScanActionsForTesting({ now: () => new Date('2026-10-15T04:00:00.000Z') });

    const result = await processScan(
      'GQR1.cp-porton.1.sig1234567890123456789012345678901234567890',
      shiftData,
    );

    expect(result).toEqual({
      status: 'out_of_window',
      message: 'Portón trasero registrado fuera de ventana',
      checkpointId: 'cp-porton',
      checkpointName: 'Portón trasero',
      recordId: '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
    });
    expect(mockRepo.saveCheckpointRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        outOfWindow: true,
        countedFor: [],
      }),
    );
  });

  // CA6, BDD 5
  it('CA6 & BDD 5: scan during grace counts for previous window with late: true', async () => {
    // Window 0 is 22:00–00:00 with 15 min grace (until 00:15). Window 1 is 00:00–02:00.
    // Portón is scanned at 00:10 (inside grace of window 0). Since window 0 lacks Portón, it counts for window 0!
    setScanActionsForTesting({ now: () => new Date('2026-10-15T00:10:00.000Z') });

    const result = await processScan(
      'GQR1.cp-porton.1.sig1234567890123456789012345678901234567890',
      shiftData,
    );

    expect(result).toEqual({
      status: 'counted',
      message: 'Portón trasero registrado',
      checkpointId: 'cp-porton',
      checkpointName: 'Portón trasero',
      recordId: '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
      countedFor: [{ roundId: 'round-perimetral', windowIndex: 0, late: true }],
    });
  });

  // CA7, BDD 6
  it('CA7 & BDD 6: scan before minimum time is rejected with exact formatted message', async () => {
    // Portón was recorded at 00:10 for window 0
    mockRepo.checkpointRecords.push({
      recordId: 'rec-grace',
      shiftId: 'shift-deposito',
      checkpointId: 'cp-porton',
      checkpointName: 'Portón trasero',
      occurredAtUtc: '2026-10-15T00:10:00.000Z',
      countedFor: [{ roundId: 'round-perimetral', windowIndex: 0, late: true }],
      outOfWindow: false,
      serverResult: 'recorded',
      serverReason: null,
      createdAt: '2026-10-15T00:10:01.000Z',
    });

    // Pedro scans again at 00:11 (candidate is Window 1: 00:00–02:00, duration 2h, half is 1h, so retryAfter is 01:10)
    setScanActionsForTesting({ now: () => new Date('2026-10-15T00:11:00.000Z') });

    const result = await processScan(
      'GQR1.cp-porton.1.sig1234567890123456789012345678901234567890',
      shiftData,
    );

    expect(result).toEqual({
      status: 'too_soon',
      message: 'Ya registraste Portón trasero a las 0:10. Podés volver a registrarlo desde la 1:10',
      checkpointId: 'cp-porton',
      checkpointName: 'Portón trasero',
      retryAfterUtc: '2026-10-15T01:10:00.000Z',
    });
    expect(mockRepo.addPendingEvent).not.toHaveBeenCalled();
    expect(mockRepo.saveCheckpointRecord).not.toHaveBeenCalled();
  });

  // CA9, BDD 7
  it('CA9 & BDD 7: shared checkpoint between two rounds counts for both rounds', async () => {
    // Galpón 1 is shared between Perimetral and Interna
    setScanActionsForTesting({ now: () => new Date('2026-10-14T22:30:00.000Z') });

    const result = await processScan(
      'GQR1.cp-galpon.1.sig1234567890123456789012345678901234567890',
      shiftData,
    );

    expect(result).toEqual({
      status: 'counted',
      message: 'Galpón 1 registrado',
      checkpointId: 'cp-galpon',
      checkpointName: 'Galpón 1',
      recordId: '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
      countedFor: [
        { roundId: 'round-perimetral', windowIndex: 0, late: false },
        { roundId: 'round-interna', windowIndex: 0, late: false },
      ],
    });
  });

  // Offline behavior
  it('stores event locally without calling API when offline', async () => {
    setScanActionsForTesting({ online: async () => false });

    const result = await processScan(
      'GQR1.cp-porton.1.sig1234567890123456789012345678901234567890',
      shiftData,
    );

    expect(result.status).toBe('counted');
    expect(mockRepo.addPendingEvent).toHaveBeenCalled();
    expect(mockRepo.saveCheckpointRecord).toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(mockRepo.sentEvents.has('0199c2c6-958d-7a4a-9f4f-f2ca1b852040')).toBe(false);
  });

  // Server rejected response
  it('updates local record when server returns rejected', async () => {
    sendMock.mockResolvedValueOnce({
      result: 'rejected',
      recordId: '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
      reason: 'signature',
    });

    const result = await processScan(
      'GQR1.cp-porton.1.sig1234567890123456789012345678901234567890',
      shiftData,
    );

    expect(result.status).toBe('counted');
    expect(mockRepo.updateCheckpointRecordServerResult).toHaveBeenCalledWith(
      '0199c2c6-958d-7a4a-9f4f-f2ca1b852040',
      'rejected',
      'signature',
    );
  });
});

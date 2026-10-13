import { computeRoundWindows } from '../rounds/windows';
import {
  formatTooSoonMessage,
  imputeRecord,
  windowCompletion,
  type ImputeRecordInput,
} from './record-imputation';
import type { ShiftOfflineData } from './shift-offline-data';

describe('record imputation (ID-140 / HU-11)', () => {
  const timezone = 'America/Argentina/Buenos_Aires';

  // Helper para construir ventanas de prueba con computeRoundWindows
  function buildRoundWindows(
    roundId: string,
    localDate: string,
    windowStartLocal: string,
    windowEndLocal: string,
    frequencyMinutes: number,
  ): ShiftOfflineData['windows'] {
    const rawWindows = computeRoundWindows(localDate, {
      windowStartLocal,
      windowEndLocal,
      frequencyMinutes,
      timezone,
    });

    return rawWindows.map((rw, index) => ({
      roundId,
      index,
      startUtc: rw.startUtc,
      endUtc: rw.endUtc,
      label: rw.label,
    }));
  }

  // Configuración base de la ronda "Perimetral" de 22 a 06 cada 2 h con 15 min de gracia
  const perimetralRound: ShiftOfflineData['rounds'][number] = {
    roundId: 'round-perimetral',
    roundVersionId: 'ver-perimetral-1',
    name: 'Perimetral',
    frequencyMinutes: 120,
    windowStartLocal: '22:00',
    windowEndLocal: '06:00',
    graceMinutes: 15,
    checkpointIds: ['cp-porton-trasero', 'cp-acceso-principal'],
  };

  // 2026-10-13 local -> ventanas:
  // 0: 22:00–00:00 local (2026-10-14T01:00:00.000Z – 2026-10-14T03:00:00.000Z)
  // 1: 00:00–02:00 local (2026-10-14T03:00:00.000Z – 2026-10-14T05:00:00.000Z)
  // 2: 02:00–04:00 local (2026-10-14T05:00:00.000Z – 2026-10-14T07:00:00.000Z)
  // 3: 04:00–06:00 local (2026-10-14T07:00:00.000Z – 2026-10-14T09:00:00.000Z)
  const perimetralWindows = buildRoundWindows(
    'round-perimetral',
    '2026-10-13',
    '22:00',
    '06:00',
    120,
  );

  describe('CA6 / BDD 5 — Registro durante la gracia', () => {
    it('cuenta para la ventana anterior con late=true si le falta el punto, y queda complete_late', () => {
      // Registro a las 00:10 local (03:10 UTC), durante la gracia de la ventana 22–00 (fin a las 03:00 UTC, gracia hasta 03:15 UTC)
      const occurredAtUtc = '2026-10-14T03:10:00.000Z';

      // En la ventana 22–00 ya se registró acceso principal, pero falta portón trasero
      const previousRecords: ImputeRecordInput['previousRecords'] = [
        {
          checkpointId: 'cp-acceso-principal',
          occurredAtUtc: '2026-10-14T01:30:00.000Z',
          countedFor: [{ roundId: 'round-perimetral', windowIndex: 0 }],
        },
      ];

      const result = imputeRecord({
        rounds: [perimetralRound],
        windows: perimetralWindows,
        checkpointId: 'cp-porton-trasero',
        occurredAtUtc,
        previousRecords,
      });

      expect(result).toEqual({
        kind: 'counted',
        countedFor: [{ roundId: 'round-perimetral', windowIndex: 0, late: true }],
      });

      // windowCompletion con este registro incorporado queda complete_late
      const allRecords = [
        ...previousRecords,
        {
          checkpointId: 'cp-porton-trasero',
          occurredAtUtc,
          countedFor: [{ roundId: 'round-perimetral', windowIndex: 0, late: true }],
        },
      ];

      const firstWindow = perimetralWindows[0];
      expect(firstWindow).toBeDefined();
      if (!firstWindow) return;

      expect(windowCompletion(perimetralRound, firstWindow, allRecords)).toBe('complete_late');
    });

    it('la ventana queda incomplete si todavía le falta otro punto a pesar del registro en gracia', () => {
      const occurredAtUtc = '2026-10-14T03:10:00.000Z';
      const allRecords = [
        {
          checkpointId: 'cp-porton-trasero',
          occurredAtUtc,
          countedFor: [{ roundId: 'round-perimetral', windowIndex: 0, late: true }],
        },
      ];

      const firstWindow = perimetralWindows[0];
      expect(firstWindow).toBeDefined();
      if (!firstWindow) return;

      expect(windowCompletion(perimetralRound, firstWindow, allRecords)).toBe('incomplete');
    });
  });

  describe('CA7 / BDD 6 — Registro repetido antes del tiempo mínimo', () => {
    it('devuelve too_soon con retryAfter y el mensaje exacto al escanear a las 00:11 luego de registrar a las 00:10', () => {
      // Portón trasero registrado a las 00:10 local para la ventana 22–00
      const lastRecordedAtUtc = '2026-10-14T03:10:00.000Z';
      const previousRecords: ImputeRecordInput['previousRecords'] = [
        {
          checkpointId: 'cp-porton-trasero',
          occurredAtUtc: lastRecordedAtUtc,
          countedFor: [{ roundId: 'round-perimetral', windowIndex: 0 }],
        },
      ];

      // Pedro vuelve a escanear a las 00:11 local (03:11 UTC)
      const occurredAtUtc = '2026-10-14T03:11:00.000Z';
      const result = imputeRecord({
        rounds: [perimetralRound],
        windows: perimetralWindows,
        checkpointId: 'cp-porton-trasero',
        occurredAtUtc,
        previousRecords,
      });

      // Duración de ventana 00–02 es 120 min -> mitad = 60 min -> retryAfter a las 01:10 local (04:10 UTC)
      const expectedRetryAfterUtc = '2026-10-14T04:10:00.000Z';
      expect(result).toEqual({
        kind: 'too_soon',
        lastRecordedAtUtc,
        retryAfterUtc: expectedRetryAfterUtc,
      });

      if (result.kind === 'too_soon') {
        const message = formatTooSoonMessage('Portón trasero', result, timezone);
        expect(message).toBe(
          'Ya registraste Portón trasero a las 0:10. Podés volver a registrarlo desde la 1:10',
        );
      }
    });

    it('permite el registro a partir del tiempo mínimo exacto (01:10 local)', () => {
      const lastRecordedAtUtc = '2026-10-14T03:10:00.000Z';
      const previousRecords: ImputeRecordInput['previousRecords'] = [
        {
          checkpointId: 'cp-porton-trasero',
          occurredAtUtc: lastRecordedAtUtc,
          countedFor: [{ roundId: 'round-perimetral', windowIndex: 0 }],
        },
      ];

      // A las 01:10 local (04:10 UTC) pasaron exactamente 60 minutos
      const occurredAtUtc = '2026-10-14T04:10:00.000Z';
      const result = imputeRecord({
        rounds: [perimetralRound],
        windows: perimetralWindows,
        checkpointId: 'cp-porton-trasero',
        occurredAtUtc,
        previousRecords,
      });

      expect(result).toEqual({
        kind: 'counted',
        countedFor: [{ roundId: 'round-perimetral', windowIndex: 1, late: false }],
      });
    });
  });

  describe('BDD 4 — Punto ya registrado en la ventana actual', () => {
    it('informa already_recorded si el punto ya fue registrado en la ventana actual', () => {
      // Registrado en la ventana 00–02 a las 00:30 local (03:30 UTC)
      const previousRecords: ImputeRecordInput['previousRecords'] = [
        {
          checkpointId: 'cp-porton-trasero',
          occurredAtUtc: '2026-10-14T03:30:00.000Z',
          countedFor: [{ roundId: 'round-perimetral', windowIndex: 1 }],
        },
      ];

      // Escaneo a la 01:30 local (04:30 UTC) -> 60 min pasaron, pero ya está registrado en la ventana 1
      const occurredAtUtc = '2026-10-14T04:30:00.000Z';
      const result = imputeRecord({
        rounds: [perimetralRound],
        windows: perimetralWindows,
        checkpointId: 'cp-porton-trasero',
        occurredAtUtc,
        previousRecords,
      });

      expect(result).toEqual({ kind: 'already_recorded' });
    });
  });

  describe('CA5 — Fuera de toda ventana y gracia', () => {
    it('retorna out_of_window si el registro ocurre fuera de toda ventana y gracia (ej. 07:00)', () => {
      // La ronda termina a las 06:00 (09:00 UTC) con gracia hasta las 06:15 (09:15 UTC)
      // Registro a las 07:00 local (10:00 UTC)
      const occurredAtUtc = '2026-10-14T10:00:00.000Z';
      const result = imputeRecord({
        rounds: [perimetralRound],
        windows: perimetralWindows,
        checkpointId: 'cp-porton-trasero',
        occurredAtUtc,
        previousRecords: [],
      });

      expect(result).toEqual({ kind: 'out_of_window' });
    });

    it('retorna out_of_window si el punto no pertenece a ninguna ronda', () => {
      const result = imputeRecord({
        rounds: [perimetralRound],
        windows: perimetralWindows,
        checkpointId: 'cp-desconocido',
        occurredAtUtc: '2026-10-14T01:30:00.000Z',
        previousRecords: [],
      });

      expect(result).toEqual({ kind: 'out_of_window' });
    });
  });

  describe('CA9 / BDD 7 — Puntos compartidos entre rondas', () => {
    const roundInterna: ShiftOfflineData['rounds'][number] = {
      roundId: 'round-interna',
      roundVersionId: 'ver-interna-1',
      name: 'Interna',
      frequencyMinutes: 120,
      windowStartLocal: '22:00',
      windowEndLocal: '06:00',
      graceMinutes: 15,
      checkpointIds: ['cp-galpon-1', 'cp-oficinas'],
    };

    const roundPerimetralConGalpon: ShiftOfflineData['rounds'][number] = {
      ...perimetralRound,
      checkpointIds: ['cp-porton-trasero', 'cp-acceso-principal', 'cp-galpon-1'],
    };

    const internaWindows = buildRoundWindows('round-interna', '2026-10-13', '22:00', '06:00', 120);

    it('un solo registro a las 22:30 de Galpón 1 cuenta para Perimetral e Interna', () => {
      const occurredAtUtc = '2026-10-14T01:30:00.000Z'; // 22:30 local
      const result = imputeRecord({
        rounds: [roundPerimetralConGalpon, roundInterna],
        windows: [...perimetralWindows, ...internaWindows],
        checkpointId: 'cp-galpon-1',
        occurredAtUtc,
        previousRecords: [],
      });

      expect(result).toEqual({
        kind: 'counted',
        countedFor: [
          { roundId: 'round-perimetral', windowIndex: 0, late: false },
          { roundId: 'round-interna', windowIndex: 0, late: false },
        ],
      });
    });

    it('tiempo mínimo evaluado por ronda: si en una es too_soon y en otra cuenta, counted solo con la otra', () => {
      // Supongamos que en Perimetral Galpón 1 ya se registró a las 00:05 para la ventana 0 en gracia
      // Y a las 00:08 se escanea de nuevo Galpón 1:
      // Para Perimetral (ventana 1 es candidata), no pasó la mitad de la duración (60 min) -> too_soon
      // Para Interna, ventana 0 es de 00:00 a 04:00 (o no tenía registros previos en la ventana actual)
      const roundInterna4h: ShiftOfflineData['rounds'][number] = {
        roundId: 'round-interna-4h',
        roundVersionId: 'ver-interna-4h',
        name: 'Interna 4h',
        frequencyMinutes: 240,
        windowStartLocal: '00:00',
        windowEndLocal: '04:00',
        graceMinutes: 15,
        checkpointIds: ['cp-galpon-1'],
      };
      const interna4hWindows = buildRoundWindows(
        'round-interna-4h',
        '2026-10-14',
        '00:00',
        '04:00',
        240,
      );

      const lastRecordedAtUtc = '2026-10-14T03:05:00.000Z'; // 00:05 local
      const previousRecords: ImputeRecordInput['previousRecords'] = [
        {
          checkpointId: 'cp-galpon-1',
          occurredAtUtc: lastRecordedAtUtc,
          countedFor: [{ roundId: 'round-perimetral', windowIndex: 0 }],
        },
      ];

      // Escaneo a las 00:10 local (03:10 UTC)
      const occurredAtUtc = '2026-10-14T03:10:00.000Z';
      const result = imputeRecord({
        rounds: [roundPerimetralConGalpon, roundInterna4h],
        windows: [...perimetralWindows, ...interna4hWindows],
        checkpointId: 'cp-galpon-1',
        occurredAtUtc,
        previousRecords,
      });

      // Perimetral da too_soon, pero Interna 4h cuenta. El resultado global debe ser counted solo para Interna 4h
      expect(result).toEqual({
        kind: 'counted',
        countedFor: [{ roundId: 'round-interna-4h', windowIndex: 0, late: false }],
      });
    });
  });

  describe('Última ventana más corta (20 a 1 cada 2 h)', () => {
    // 20 a 1 cada 2 h: ventanas 20–22, 22–00, 00–01. La ventana 00–01 dura 1 h (60 min).
    // Mitad de duración de la ventana 00–01 = 30 min.
    const clippedRound: ShiftOfflineData['rounds'][number] = {
      roundId: 'round-clipped',
      roundVersionId: 'ver-clipped-1',
      name: 'Ronda Corta',
      frequencyMinutes: 120,
      windowStartLocal: '20:00',
      windowEndLocal: '01:00',
      graceMinutes: 15,
      checkpointIds: ['cp-1'],
    };

    const clippedWindows = buildRoundWindows('round-clipped', '2026-10-13', '20:00', '01:00', 120);

    it('la ventana 00–01 dura 1 h y exige un tiempo mínimo de 30 min', () => {
      // Ventana 00–01: startUtc = 2026-10-14T03:00:00.000Z, endUtc = 2026-10-14T04:00:00.000Z
      expect(clippedWindows[2]?.label).toBe('00:00–01:00');

      // Registro en ventana 1 (22–00) a las 23:50 local (02:50 UTC)
      const lastRecordedAtUtc = '2026-10-14T02:50:00.000Z';
      const previousRecords: ImputeRecordInput['previousRecords'] = [
        {
          checkpointId: 'cp-1',
          occurredAtUtc: lastRecordedAtUtc,
          countedFor: [{ roundId: 'round-clipped', windowIndex: 1 }],
        },
      ];

      // A las 00:10 local (03:10 UTC): pasaron 20 min < 30 min -> too_soon
      const resultTooSoon = imputeRecord({
        rounds: [clippedRound],
        windows: clippedWindows,
        checkpointId: 'cp-1',
        occurredAtUtc: '2026-10-14T03:10:00.000Z',
        previousRecords,
      });

      expect(resultTooSoon).toEqual({
        kind: 'too_soon',
        lastRecordedAtUtc,
        retryAfterUtc: '2026-10-14T03:20:00.000Z', // 23:50 + 30 min = 00:20 local (03:20 UTC)
      });

      // A las 00:25 local (03:25 UTC): pasaron 35 min >= 30 min -> cuenta
      const resultCounted = imputeRecord({
        rounds: [clippedRound],
        windows: clippedWindows,
        checkpointId: 'cp-1',
        occurredAtUtc: '2026-10-14T03:25:00.000Z',
        previousRecords,
      });

      expect(resultCounted).toEqual({
        kind: 'counted',
        countedFor: [{ roundId: 'round-clipped', windowIndex: 2, late: false }],
      });
    });
  });

  describe('Cruce de medianoche y franja de 24 horas (06:00 a 06:00)', () => {
    const round24h: ShiftOfflineData['rounds'][number] = {
      roundId: 'round-24h',
      roundVersionId: 'ver-24h',
      name: 'Ronda 24h',
      frequencyMinutes: 120,
      windowStartLocal: '06:00',
      windowEndLocal: '06:00',
      graceMinutes: 15,
      checkpointIds: ['cp-base'],
    };

    const windows24h = buildRoundWindows('round-24h', '2026-10-13', '06:00', '06:00', 120);

    it('tiene 12 ventanas y maneja el cruce de medianoche', () => {
      expect(windows24h).toHaveLength(12);

      // Ventana 8 es 22:00–00:00, ventana 9 es 00:00–02:00
      expect(windows24h[8]?.label).toBe('22:00–00:00');
      expect(windows24h[9]?.label).toBe('00:00–02:00');

      // Escaneo a las 00:05 local con ventana 8 faltante -> cuenta para ventana 8 con late=true
      const resultLate = imputeRecord({
        rounds: [round24h],
        windows: windows24h,
        checkpointId: 'cp-base',
        occurredAtUtc: '2026-10-14T03:05:00.000Z',
        previousRecords: [],
      });

      expect(resultLate).toEqual({
        kind: 'counted',
        countedFor: [{ roundId: 'round-24h', windowIndex: 8, late: true }],
      });
    });
  });

  describe('Gracia en 0 y bordes exactos de ventana', () => {
    const zeroGraceRound: ShiftOfflineData['rounds'][number] = {
      ...perimetralRound,
      graceMinutes: 0,
    };

    it('con gracia 0, el fin exacto de una ventana pertenece a la siguiente ventana (no late)', () => {
      // 00:00:00 local (2026-10-14T03:00:00.000Z) es el fin exacto de ventana 0 (22–00)
      // y el inicio exacto de ventana 1 (00–02)
      const occurredAtUtc = '2026-10-14T03:00:00.000Z';
      const result = imputeRecord({
        rounds: [zeroGraceRound],
        windows: perimetralWindows,
        checkpointId: 'cp-porton-trasero',
        occurredAtUtc,
        previousRecords: [],
      });

      expect(result).toEqual({
        kind: 'counted',
        countedFor: [{ roundId: 'round-perimetral', windowIndex: 1, late: false }],
      });
    });

    it('con gracia 15, fin + gracia exacto ya no es gracia y cae en la ventana actual', () => {
      // Ventana 0 termina a las 03:00:00 UTC. Gracia de 15 min termina a las 03:15:00 UTC exacto.
      // A las 03:15:00 UTC exacto, ya no es gracia de ventana 0; pertenece a ventana 1 sin late.
      const occurredAtUtc = '2026-10-14T03:15:00.000Z';
      const result = imputeRecord({
        rounds: [perimetralRound],
        windows: perimetralWindows,
        checkpointId: 'cp-porton-trasero',
        occurredAtUtc,
        previousRecords: [],
      });

      expect(result).toEqual({
        kind: 'counted',
        countedFor: [{ roundId: 'round-perimetral', windowIndex: 1, late: false }],
      });
    });

    it('en la última ventana, fin + gracia exacto queda out_of_window', () => {
      // Última ventana (ventana 3) termina a las 06:00 local (09:00:00 UTC). Gracia termina a las 09:15:00 UTC.
      const occurredAtUtc = '2026-10-14T09:15:00.000Z';
      const result = imputeRecord({
        rounds: [perimetralRound],
        windows: perimetralWindows,
        checkpointId: 'cp-porton-trasero',
        occurredAtUtc,
        previousRecords: [],
      });

      expect(result).toEqual({ kind: 'out_of_window' });
    });
  });

  describe('Asignación de turno (HU-44)', () => {
    it('una ventana que termina fuera de la asignación no cuenta', () => {
      // Asignación de 22:00 a 02:00 local (01:00 UTC a 05:00 UTC)
      const assignment = {
        startsAtUtc: '2026-10-14T01:00:00.000Z',
        endsAtUtc: '2026-10-14T05:00:00.000Z',
      };

      // Escaneo a las 02:30 local (05:30 UTC): cae en ventana 2 (02–04), que termina a las 07:00 UTC
      // Como termina después de las 05:00 UTC, no es elegible
      const result = imputeRecord({
        rounds: [perimetralRound],
        windows: perimetralWindows,
        checkpointId: 'cp-porton-trasero',
        occurredAtUtc: '2026-10-14T05:30:00.000Z',
        previousRecords: [],
        assignment,
      });

      expect(result).toEqual({ kind: 'out_of_window' });
    });

    it('cuenta normalmente para una ventana que termina dentro de la asignación', () => {
      const assignment = {
        startsAtUtc: '2026-10-14T01:00:00.000Z',
        endsAtUtc: '2026-10-14T05:00:00.000Z',
      };

      // Escaneo a las 01:00 local (04:00 UTC): ventana 1 (00–02) termina a las 05:00 UTC, dentro de la asignación
      const result = imputeRecord({
        rounds: [perimetralRound],
        windows: perimetralWindows,
        checkpointId: 'cp-porton-trasero',
        occurredAtUtc: '2026-10-14T04:00:00.000Z',
        previousRecords: [],
        assignment,
      });

      expect(result).toEqual({
        kind: 'counted',
        countedFor: [{ roundId: 'round-perimetral', windowIndex: 1, late: false }],
      });
    });
  });

  describe('formatTooSoonMessage — gramática en español', () => {
    it('usa "a las 0:10" y "desde la 1:10" (hora 0 -> las, hora 1 -> la)', () => {
      const msg = formatTooSoonMessage(
        'Portón trasero',
        {
          lastRecordedAtUtc: '2026-10-14T03:10:00.000Z',
          retryAfterUtc: '2026-10-14T04:10:00.000Z',
        },
        timezone,
      );
      expect(msg).toBe(
        'Ya registraste Portón trasero a las 0:10. Podés volver a registrarlo desde la 1:10',
      );
    });

    it('usa "a la 1:10" y "desde las 2:10" (hora 1 -> la, hora 2 -> las)', () => {
      const msg = formatTooSoonMessage(
        'Portón trasero',
        {
          lastRecordedAtUtc: '2026-10-14T04:10:00.000Z',
          retryAfterUtc: '2026-10-14T05:10:00.000Z',
        },
        timezone,
      );
      expect(msg).toBe(
        'Ya registraste Portón trasero a la 1:10. Podés volver a registrarlo desde las 2:10',
      );
    });
  });

  describe('windowCompletion', () => {
    const round = {
      roundId: 'r1',
      checkpointIds: ['cp-a', 'cp-b'],
    };
    const window = {
      roundId: 'r1',
      index: 0,
    };

    it('retorna complete si todos los puntos se registraron a tiempo', () => {
      const records = [
        {
          checkpointId: 'cp-a',
          countedFor: [{ roundId: 'r1', windowIndex: 0, late: false }],
        },
        {
          checkpointId: 'cp-b',
          countedFor: [{ roundId: 'r1', windowIndex: 0, late: false }],
        },
      ];
      expect(windowCompletion(round, window, records)).toBe('complete');
    });

    it('retorna complete_late si todos los puntos se registraron pero al menos uno fue late', () => {
      const records = [
        {
          checkpointId: 'cp-a',
          countedFor: [{ roundId: 'r1', windowIndex: 0, late: false }],
        },
        {
          checkpointId: 'cp-b',
          countedFor: [{ roundId: 'r1', windowIndex: 0, late: true }],
        },
      ];
      expect(windowCompletion(round, window, records)).toBe('complete_late');
    });

    it('retorna incomplete si falta registrar algún punto de la ronda', () => {
      const records = [
        {
          checkpointId: 'cp-a',
          countedFor: [{ roundId: 'r1', windowIndex: 0, late: false }],
        },
      ];
      expect(windowCompletion(round, window, records)).toBe('incomplete');
    });

    it('retorna complete si la ronda no tiene checkpoints configurados', () => {
      expect(windowCompletion({ roundId: 'r0', checkpointIds: [] }, window, [])).toBe('complete');
    });
  });

  describe('Registro durante la gracia cuando la ventana anterior ya tenía el punto', () => {
    it('no imputa a la ventana anterior si ya tenía el punto, e imputa a la ventana actual con late=false', () => {
      // Supongamos que en la ventana 0 (22–00) ya se registró Portón trasero a las 23:00 (hace más de 60 min)
      const previousRecords: ImputeRecordInput['previousRecords'] = [
        {
          checkpointId: 'cp-porton-trasero',
          occurredAtUtc: '2026-10-14T02:00:00.000Z', // 23:00 local
          countedFor: [{ roundId: 'round-perimetral', windowIndex: 0 }],
        },
      ];

      // A las 00:10 local (03:10 UTC), cae en la gracia de ventana 0 pero ventana 0 ya tiene el punto.
      // La ventana candidata es la ventana actual 1 (00–02), y pasaron 70 min (> 60 min) desde el registro anterior.
      const occurredAtUtc = '2026-10-14T03:10:00.000Z';
      const result = imputeRecord({
        rounds: [perimetralRound],
        windows: perimetralWindows,
        checkpointId: 'cp-porton-trasero',
        occurredAtUtc,
        previousRecords,
      });

      expect(result).toEqual({
        kind: 'counted',
        countedFor: [{ roundId: 'round-perimetral', windowIndex: 1, late: false }],
      });
    });
  });
});

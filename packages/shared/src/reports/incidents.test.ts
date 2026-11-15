import {
  computeIncidentReport,
  computeResponseTimes,
  computePanicReport,
  incidentTimeBand,
  firstResponse,
  summarizeResponseTimes,
} from './incidents';

describe('HU-26 cálculos de incidentes y respuesta', () => {
  it('agrupa franjas locales de dos horas, incluyendo medianoche y hora confiable', () => {
    expect(incidentTimeBand('2026-10-02T02:59:00Z', 'America/Argentina/Buenos_Aires')).toBe(22);
    expect(incidentTimeBand('2026-10-02T03:00:00Z', 'America/Argentina/Buenos_Aires')).toBe(0);
    expect(incidentTimeBand('2026-10-02T05:00:00Z', 'America/Argentina/Buenos_Aires')).toBe(2);
    const report = computeIncidentReport(
      [
        {
          type: 'intrusion',
          classificationStatus: 'pending',
          site: { id: 'p', name: 'Predio' },
          occurredAtDevice: '2026-10-02T02:00:00Z',
          trustedAt: '2026-10-02T05:00:00Z',
          receivedAt: '2026-10-02T06:00:00Z',
        },
      ],
      'America/Argentina/Buenos_Aires',
      new Date('2026-10-04T06:00:00Z'),
    );
    expect(report.byTimeBand.find((row) => row.id === '2')?.value).toBe(1);
    expect(report.pending.oldestAgeMs).toBe(2 * 86400_000);
    expect(report.byClassification.find((row) => row.id === 'pending')?.value).toBe(1);
  });
  it('mide CA2 desde envío: SMS 03:10, recibido 03:25, confirmado 03:27 = 17 min', () => {
    const result = computeResponseTimes(
      [
        {
          site: { id: 'p', name: 'Predio' },
          triggeredAt: '2026-10-01T03:10:00Z',
          confirmedAt: '2026-10-01T03:27:00Z',
          confirmedBy: { id: 's', name: 'Ana' },
          escalatedAt: null,
        },
      ],
      [],
      [],
    );
    expect(result.totals.panic.averageMs).toBe(17 * 60_000);
    expect(result.bySupervisor[0]?.times.panic.maximumMs).toBe(17 * 60_000);
  });
  it('calcula promedio y máximo, excluye sin confirmar y cuenta escaladas', () => {
    expect(
      summarizeResponseTimes([
        { startedAt: '2026-10-01T00:00:00Z', respondedAt: '2026-10-01T00:02:00Z', escalated: true },
        { startedAt: '2026-10-01T00:00:00Z', respondedAt: '2026-10-01T00:04:00Z' },
        { startedAt: '2026-10-01T00:00:00Z', respondedAt: null, escalated: true },
      ]),
    ).toEqual({ count: 2, averageMs: 180000, maximumMs: 240000, unanswered: 1, escalated: 2 });
    expect(summarizeResponseTimes([]).averageMs).toBeNull();
  });
  it('toma solo la primera lectura y la primera clasificación aunque se reclasifique', () => {
    const decisions = [
      { at: '2026-10-01T00:09:00Z', by: { id: 'b', name: 'B' } },
      { at: '2026-10-01T00:02:00Z', by: { id: 'a', name: 'A' } },
    ];
    expect(firstResponse(decisions)?.by.id).toBe('a');
    const item = {
      site: { id: 'p', name: 'Predio' },
      startedAt: '2026-10-01T00:00:00Z',
      responses: decisions,
    };
    const result = computeResponseTimes([], [item], [item]);
    expect(result.totals.missedRound.averageMs).toBe(120000);
    expect(result.totals.classification.maximumMs).toBe(120000);
    expect(result.bySupervisor.map((row) => row.id)).toEqual(['a']);
  });
  it('separa resultado, sin resolver y canal, y calcula proporción de falsas alarmas', () => {
    const result = computePanicReport([
      { outcome: 'false_alarm', channel: 'sms' },
      { outcome: null, channel: 'internet' },
    ]);
    expect(result.byOutcome.find((row) => row.id === 'unresolved')?.value).toBe(1);
    expect(result.byChannel.find((row) => row.id === 'sms')?.value).toBe(1);
    expect(result.falseAlarmProportion).toBe(0.5);
  });
});

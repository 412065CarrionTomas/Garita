import type { ShiftOfflineData } from './shift-offline-data';

export interface ImputedCountedWindow {
  roundId: string;
  windowIndex: number;
  late: boolean;
}

export type RecordImputation =
  | { kind: 'counted'; countedFor: ImputedCountedWindow[] }
  | { kind: 'out_of_window' }
  | { kind: 'too_soon'; lastRecordedAtUtc: string; retryAfterUtc: string }
  | { kind: 'already_recorded' };

export interface ImputeRecordInput {
  rounds: ShiftOfflineData['rounds'];
  windows: ShiftOfflineData['windows'];
  checkpointId: string;
  occurredAtUtc: string;
  previousRecords: readonly {
    checkpointId: string;
    occurredAtUtc: string;
    countedFor: readonly { roundId: string; windowIndex: number }[];
  }[];
  assignment?: { startsAtUtc: string; endsAtUtc: string };
}

/**
 * Imputación pura de registros de puntos a ventanas de ronda (HU-11, ID-140).
 * Utilizada tanto en el backend como en la app móvil en modo sin señal.
 */
export function imputeRecord(input: ImputeRecordInput): RecordImputation {
  const occurredTime = Date.parse(input.occurredAtUtc);

  // HU-44: solo cuentan ventanas que terminan dentro de la asignación
  let eligibleWindows = input.windows;
  if (input.assignment) {
    const assignStart = Date.parse(input.assignment.startsAtUtc);
    const assignEnd = Date.parse(input.assignment.endsAtUtc);
    eligibleWindows = eligibleWindows.filter((w) => {
      const wEnd = Date.parse(w.endUtc);
      return wEnd > assignStart && wEnd <= assignEnd;
    });
  }

  // Filtrar rondas que incluyen el punto
  const eligibleRounds = input.rounds.filter((r) => r.checkpointIds.includes(input.checkpointId));
  if (eligibleRounds.length === 0) {
    return { kind: 'out_of_window' };
  }

  const countedFor: ImputedCountedWindow[] = [];
  const tooSoonCandidates: { lastRecordedAtUtc: string; retryAfterUtc: string }[] = [];
  let hasAlreadyRecorded = false;

  for (const round of eligibleRounds) {
    const roundWindows = eligibleWindows
      .filter((w) => w.roundId === round.roundId)
      .slice()
      .sort((a, b) => a.index - b.index);

    if (roundWindows.length === 0) {
      continue;
    }

    // 1. Determinar ventana candidata:
    // Si occurredAt cae en la gracia de la ventana anterior ([fin, fin + gracia))
    // y a esa ventana le falta el punto, la candidata es la anterior (late);
    // si no, es la ventana actual ([inicio, fin)).
    let candidateWindow: (typeof roundWindows)[number] | null = null;
    let isLate = false;

    const graceMs = round.graceMinutes * 60 * 1000;
    if (graceMs > 0) {
      for (const w of roundWindows) {
        const wEnd = Date.parse(w.endUtc);
        if (occurredTime >= wEnd && occurredTime < wEnd + graceMs) {
          const lacksCheckpoint = !input.previousRecords.some(
            (pr) =>
              pr.checkpointId === input.checkpointId &&
              pr.countedFor.some((c) => c.roundId === round.roundId && c.windowIndex === w.index),
          );
          if (lacksCheckpoint) {
            candidateWindow = w;
            isLate = true;
            break;
          }
        }
      }
    }

    if (!candidateWindow) {
      for (const w of roundWindows) {
        const wStart = Date.parse(w.startUtc);
        const wEnd = Date.parse(w.endUtc);
        if (occurredTime >= wStart && occurredTime < wEnd) {
          candidateWindow = w;
          isLate = false;
          break;
        }
      }
    }

    // Sin candidata -> esta ronda no aporta
    if (!candidateWindow) {
      continue;
    }

    // 2. Si la candidata ya tiene el punto registrado -> "ya registrada"
    const alreadyInCandidate = input.previousRecords.some(
      (pr) =>
        pr.checkpointId === input.checkpointId &&
        pr.countedFor.some(
          (c) => c.roundId === round.roundId && c.windowIndex === candidateWindow.index,
        ),
    );
    if (alreadyInCandidate) {
      hasAlreadyRecorded = true;
      continue;
    }

    // 3. Tiempo mínimo: si hay un registro anterior del mismo punto que contó para esa ronda,
    // y no pasó al menos la mitad de la duración de la ventana candidata desde ese registro
    // -> esa ronda queda "demasiado pronto", con retryAfter = registro anterior + duración/2
    const previousForThisRound = input.previousRecords.filter(
      (pr) =>
        pr.checkpointId === input.checkpointId &&
        pr.countedFor.some((c) => c.roundId === round.roundId) &&
        Date.parse(pr.occurredAtUtc) <= occurredTime,
    );

    const firstPrev = previousForThisRound[0];
    if (firstPrev) {
      let lastRecord = firstPrev;
      let lastTime = Date.parse(firstPrev.occurredAtUtc);
      for (let i = 1; i < previousForThisRound.length; i += 1) {
        const candidate = previousForThisRound[i];
        if (candidate) {
          const t = Date.parse(candidate.occurredAtUtc);
          if (t > lastTime) {
            lastRecord = candidate;
            lastTime = t;
          }
        }
      }

      const candDurationMs =
        Date.parse(candidateWindow.endUtc) - Date.parse(candidateWindow.startUtc);
      const halfDurationMs = candDurationMs / 2;

      if (occurredTime - lastTime < halfDurationMs) {
        const retryAfterTime = lastTime + halfDurationMs;
        tooSoonCandidates.push({
          lastRecordedAtUtc: lastRecord.occurredAtUtc,
          retryAfterUtc: new Date(retryAfterTime).toISOString(),
        });
        continue;
      }
    }

    // 4. Si no, la ronda cuenta
    countedFor.push({
      roundId: round.roundId,
      windowIndex: candidateWindow.index,
      late: isLate,
    });
  }

  // Resultado agregado
  if (countedFor.length > 0) {
    return { kind: 'counted', countedFor };
  }

  const earliestTooSoon = tooSoonCandidates[0];
  if (earliestTooSoon) {
    tooSoonCandidates.sort((a, b) => Date.parse(a.retryAfterUtc) - Date.parse(b.retryAfterUtc));
    const sortedEarliest = tooSoonCandidates[0];
    if (sortedEarliest) {
      return {
        kind: 'too_soon',
        lastRecordedAtUtc: sortedEarliest.lastRecordedAtUtc,
        retryAfterUtc: sortedEarliest.retryAfterUtc,
      };
    }
  }

  if (hasAlreadyRecorded) {
    return { kind: 'already_recorded' };
  }

  return { kind: 'out_of_window' };
}

export type WindowCompletionStatus = 'complete' | 'complete_late' | 'incomplete';

/**
 * Evalúa si una ventana de ronda está completa, completa con demora o incompleta (HU-16).
 */
export function windowCompletion(
  round: Pick<ShiftOfflineData['rounds'][number], 'roundId' | 'checkpointIds'>,
  window: Pick<ShiftOfflineData['windows'][number], 'roundId' | 'index'>,
  records: readonly {
    checkpointId: string;
    countedFor: readonly { roundId: string; windowIndex: number; late?: boolean }[];
  }[],
): WindowCompletionStatus {
  if (round.checkpointIds.length === 0) {
    return 'complete';
  }

  const matchingRecords = records.filter((r) =>
    r.countedFor.some((c) => c.roundId === round.roundId && c.windowIndex === window.index),
  );

  const recordedCheckpointIds = new Set(matchingRecords.map((r) => r.checkpointId));
  const isComplete = round.checkpointIds.every((cpId) => recordedCheckpointIds.has(cpId));

  if (!isComplete) {
    return 'incomplete';
  }

  const anyLate = matchingRecords.some((r) =>
    r.countedFor.some(
      (c) => c.roundId === round.roundId && c.windowIndex === window.index && Boolean(c.late),
    ),
  );

  return anyLate ? 'complete_late' : 'complete';
}

/**
 * Da formato al mensaje en español de BDD 6 ante escaneos antes del tiempo mínimo.
 * Formato de hora: H:mm (sin cero a la izquierda).
 * Artículos: "la" para la 1 y "las" para las demás horas.
 */
export function formatTooSoonMessage(
  checkpointName: string,
  tooSoon: { lastRecordedAtUtc: string; retryAfterUtc: string },
  /** IANA zone of the company; required so the guard never sees the phone's or UTC time. */
  timezone: string,
): string {
  const { lastRecordedAtUtc, retryAfterUtc } = tooSoon;

  const lastParts = getTimeParts(lastRecordedAtUtc, timezone);
  const retryParts = getTimeParts(retryAfterUtc, timezone);

  const lastTimeStr = `${lastParts.hour}:${String(lastParts.minute).padStart(2, '0')}`;
  const retryTimeStr = `${retryParts.hour}:${String(retryParts.minute).padStart(2, '0')}`;

  const atArticle = lastParts.hour === 1 ? 'a la' : 'a las';
  const fromArticle = retryParts.hour === 1 ? 'desde la' : 'desde las';

  return `Ya registraste ${checkpointName} ${atArticle} ${lastTimeStr}. Podés volver a registrarlo ${fromArticle} ${retryTimeStr}`;
}

function getTimeParts(utcIso: string, timezone: string): { hour: number; minute: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(utcIso))
      .map(({ type, value }) => [type, value]),
  );

  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

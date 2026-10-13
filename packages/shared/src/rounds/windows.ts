export interface RoundWindowConfig {
  windowStartLocal: string;
  windowEndLocal: string;
  frequencyMinutes: number;
  timezone: string;
}

export interface RoundWindow extends RoundWindowConfig {
  startUtc: string;
  endUtc: string;
  label: string;
}

export interface ShiftWindowResult {
  completeWindows: RoundWindow[];
  endingInShift: RoundWindow[];
}

export function defaultGraceMinutes(frequencyMinutes: number): number {
  return Math.min(15, frequencyMinutes / 2);
}

export function validateWindowConfig(
  config: Omit<RoundWindowConfig, 'timezone'> & { graceMinutes: number },
): { field: keyof Omit<RoundWindowConfig, 'timezone'> | 'graceMinutes'; message: string }[] {
  const errors: {
    field: keyof Omit<RoundWindowConfig, 'timezone'> | 'graceMinutes';
    message: string;
  }[] = [];
  if (
    !Number.isInteger(config.frequencyMinutes) ||
    config.frequencyMinutes < 15 ||
    config.frequencyMinutes > 1440
  ) {
    errors.push({
      field: 'frequencyMinutes',
      message: 'La frecuencia debe estar entre 15 minutos y 24 horas.',
    });
  }
  if (
    !Number.isInteger(config.graceMinutes) ||
    config.graceMinutes < 0 ||
    config.graceMinutes > 60
  ) {
    errors.push({ field: 'graceMinutes', message: 'La gracia debe estar entre 0 y 60 minutos.' });
  }
  if (config.graceMinutes > config.frequencyMinutes / 2) {
    errors.push({
      field: 'graceMinutes',
      message: `La gracia puede ser, como máximo, ${config.frequencyMinutes / 2} minutos: la mitad de la frecuencia.`,
    });
  }
  if (!isLocalTime(config.windowStartLocal) || !isLocalTime(config.windowEndLocal)) {
    if (!isLocalTime(config.windowStartLocal))
      errors.push({ field: 'windowStartLocal', message: 'La hora debe tener formato HH:mm.' });
    if (!isLocalTime(config.windowEndLocal))
      errors.push({ field: 'windowEndLocal', message: 'La hora debe tener formato HH:mm.' });
  }
  return errors;
}

function isLocalTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function minutes(value: string): number {
  const hours = Number(value.slice(0, 2));
  const mins = Number(value.slice(3, 5));
  return hours * 60 + mins;
}

function localDateTimeToUtc(date: string, minuteOfDay: number, timezone: string): Date {
  const dayOffset = Math.floor(minuteOfDay / 1440);
  const minute = ((minuteOfDay % 1440) + 1440) % 1440;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const dayDate = new Date(Date.UTC(year, month - 1, day + dayOffset));
  const target = Date.UTC(
    dayDate.getUTCFullYear(),
    dayDate.getUTCMonth(),
    dayDate.getUTCDate(),
    Math.floor(minute / 60),
    minute % 60,
  );
  let guess = target;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    const difference = target - represented;
    guess += difference;
    if (difference === 0) break;
  }
  return new Date(guess);
}

function labelFor(startMinute: number, endMinute: number): string {
  const fmt = (n: number) =>
    `${String(Math.floor((((n % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((n % 1440) + 1440) % 60).padStart(2, '0')}`;
  return `${fmt(startMinute)}–${fmt(endMinute)}`;
}

/** UTC instants are ISO 8601 strings. Uses Intl only, available in browsers and Hermes. */
export function computeRoundWindows(
  localStartDate: string,
  config: RoundWindowConfig,
): RoundWindow[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localStartDate))
    throw new Error('La fecha debe tener formato YYYY-MM-DD.');
  const start = minutes(config.windowStartLocal);
  const end = minutes(config.windowEndLocal);
  const duration = (end <= start ? end + 1440 : end) - start;
  const result: RoundWindow[] = [];
  for (let offset = 0; offset < duration; offset += config.frequencyMinutes) {
    const windowEnd = Math.min(offset + config.frequencyMinutes, duration);
    result.push({
      ...config,
      startUtc: localDateTimeToUtc(localStartDate, start + offset, config.timezone).toISOString(),
      endUtc: localDateTimeToUtc(localStartDate, start + windowEnd, config.timezone).toISOString(),
      label: labelFor(start + offset, start + windowEnd),
    });
  }
  return result;
}

export function previewWindows(config: Omit<RoundWindowConfig, 'timezone'>): string[] {
  const start = minutes(config.windowStartLocal);
  const end = minutes(config.windowEndLocal);
  const duration = (end <= start ? end + 1440 : end) - start;
  const labels: string[] = [];
  for (let offset = 0; offset < duration; offset += config.frequencyMinutes)
    labels.push(
      labelFor(start + offset, start + Math.min(offset + config.frequencyMinutes, duration)),
    );
  return labels;
}

export function windowsForShift(
  windows: RoundWindow[],
  shift: { shiftStartUtc: string; shiftEndUtc: string },
): ShiftWindowResult {
  const start = Date.parse(shift.shiftStartUtc);
  const end = Date.parse(shift.shiftEndUtc);
  return {
    completeWindows: windows.filter(
      (window) => Date.parse(window.startUtc) >= start && Date.parse(window.endUtc) <= end,
    ),
    endingInShift: windows.filter(
      (window) => Date.parse(window.endUtc) > start && Date.parse(window.endUtc) <= end,
    ),
  };
}

// HU-11 will assign records to windows here, applying grace and minimum time between records.

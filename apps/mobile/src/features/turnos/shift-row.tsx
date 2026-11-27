import type { GuardShift } from '@garita/shared';
import { Badge, ListItem } from '@/ui';
import { endDay, shiftStamp } from './shift-range';

const dayFormat = new Intl.DateTimeFormat('es-AR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const dateFormat = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeZone: 'UTC' });
const atNoon = (day: string) => new Date(`${day}T12:00:00Z`);
export const formatDay = (day: string) => dayFormat.format(atNoon(day));
export const formatDate = (day: string) => dateFormat.format(atNoon(day));

// Un formateador por zona horaria: crearlos es caro en Hermes.
const timeFormats = new Map<string, Intl.DateTimeFormat>();
export function formatTime(value: string, timeZone: string) {
  let format = timeFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
    });
    timeFormats.set(timeZone, format);
  }
  return format.format(new Date(value));
}

/** "jue 26 nov · 22:00–06:00 (vie 27 nov)": si cruza la medianoche se nombra el día en que termina. */
export function shiftTitle(shift: GuardShift) {
  const end = endDay(shift);
  const hours = `${formatTime(shift.startsAt, shift.site.timezone)}–${formatTime(shift.endsAt, shift.site.timezone)}`;
  return `${formatDay(shift.serviceDate)} · ${hours}${end === shift.serviceDate ? '' : ` (${formatDay(end)})`}`;
}

/** Tarjeta de un turno: lo que le toca si viene, lo que hizo si ya pasó. */
export function ShiftRow({ shift, onOpen }: { shift: GuardShift; onOpen: (id: string) => void }) {
  const stamp = shiftStamp(shift);
  const s = shift.summary;
  const opens = shift.status === 'scheduled' || shift.status === 'in_progress';
  return (
    <ListItem
      title={shiftTitle(shift)}
      subtitle={shift.site.name}
      detail={
        s
          ? `Ventanas ${s.windowsDone}/${s.windows} · Puntos ${s.recorded}/${s.expected}${s.incidents ? ` · ${s.incidents} ${s.incidents === 1 ? 'incidente' : 'incidentes'}` : ''}`
          : `Rondas: ${shift.rounds.map((r) => r.name).join(', ') || 'sin rondas'}`
      }
      trailing={
        <Badge tone={stamp.tone} variant={opens ? 'dashed' : 'solid'} label={stamp.label} />
      }
      disabled={!opens}
      accessibilityRole={opens ? 'button' : 'text'}
      accessibilityHint={opens ? 'Abre el turno' : undefined}
      onPress={opens ? () => onOpen(shift.id) : undefined}
    />
  );
}

import { defaultGraceMinutes, previewWindows } from '@garita/shared';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface Schedule {
  frequency: number;
  start: string;
  end: string;
  grace: number;
}

/** Horario de la ronda: un resumen que se despliega con frecuencia, franja, gracia y ventanas. */
export function SchedulePicker({
  schedule,
  errors,
  onChange,
}: {
  schedule: Schedule;
  /** Errores por campo del último intento de guardar: con alguno, el horario queda abierto. */
  errors: Record<string, string[]>;
  onChange: (schedule: Schedule) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasError = Boolean(
    errors.frequencyMinutes ??
    errors.windowStartLocal ??
    errors.windowEndLocal ??
    errors.graceMinutes,
  );
  const labels = previewWindows({
    windowStartLocal: schedule.start,
    windowEndLocal: schedule.end,
    frequencyMinutes: schedule.frequency,
  });
  const errorOf = (field: string, id: string) =>
    errors[field]?.map((error) => (
      <p className="text-sm text-danger" id={id} key={error}>
        {error}
      </p>
    ));
  return (
    <details
      className="relative"
      open={open || hasError}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-md border-[1.5px] border-input px-3 hover:bg-muted [&::-webkit-details-marker]:hidden">
        <span className="t-stamp tabular-nums">
          {schedule.start === schedule.end ? 'Todo el día' : `${schedule.start}–${schedule.end}`} ·
          cada {schedule.frequency} min · {labels.length} ventanas
        </span>
        <ChevronDown aria-hidden="true" className="size-4" />
        <span className="sr-only">Horario de la ronda</span>
      </summary>
      <div className="absolute top-12 left-0 z-20 grid w-[min(36rem,90vw)] gap-3 rounded-md border-[1.5px] border-primary bg-card p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="grid gap-1.5">
            <Label htmlFor="round-frequency">Frecuencia (minutos)</Label>
            <Input
              id="round-frequency"
              aria-invalid={Boolean(errors.frequencyMinutes)}
              aria-describedby={errors.frequencyMinutes ? 'round-frequency-error' : undefined}
              type="number"
              min="15"
              max="1440"
              value={schedule.frequency}
              onChange={(event) => {
                const next = Number(event.target.value);
                onChange({ ...schedule, frequency: next, grace: defaultGraceMinutes(next) });
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="round-start">Inicio de franja</Label>
            <Input
              id="round-start"
              aria-invalid={Boolean(errors.windowStartLocal)}
              aria-describedby={errors.windowStartLocal ? 'round-start-error' : undefined}
              type="time"
              value={schedule.start}
              onChange={(event) => {
                onChange({ ...schedule, start: event.target.value });
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="round-end">Fin de franja</Label>
            <Input
              id="round-end"
              aria-invalid={Boolean(errors.windowEndLocal)}
              aria-describedby={errors.windowEndLocal ? 'round-end-error' : undefined}
              type="time"
              value={schedule.end}
              onChange={(event) => {
                onChange({ ...schedule, end: event.target.value });
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="round-grace">Gracia (minutos)</Label>
            <Input
              id="round-grace"
              aria-invalid={Boolean(errors.graceMinutes)}
              aria-describedby={errors.graceMinutes ? 'round-grace-error' : 'round-grace-help'}
              type="number"
              min="0"
              max="60"
              value={schedule.grace}
              onChange={(event) => {
                onChange({ ...schedule, grace: Number(event.target.value) });
              }}
            />
          </div>
        </div>
        <p id="round-grace-help" className="text-sm text-muted-foreground">
          Gracia predeterminada {defaultGraceMinutes(schedule.frequency)} min, máximo{' '}
          {Math.min(60, schedule.frequency / 2)}.
          {schedule.start === schedule.end && ' Todo el día (24 h).'}
        </p>
        {errorOf('frequencyMinutes', 'round-frequency-error')}
        {errorOf('windowStartLocal', 'round-start-error')}
        {errorOf('windowEndLocal', 'round-end-error')}
        {errorOf('graceMinutes', 'round-grace-error')}
        <ol aria-label="Vista previa de ventanas" className="flex flex-wrap gap-1.5">
          {labels.map((label) => (
            <li key={label} className="t-stamp bg-muted px-2 py-1 tabular-nums">
              {label}
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}

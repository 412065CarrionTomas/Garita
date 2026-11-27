import { useState, type SyntheticEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  computeStartWindow,
  computeSyncDeadline,
  siteConnectivitySchema,
  type SiteConnectivity,
} from '@garita/shared';
import { apiPut } from '@/lib/api-client';
import { errorMessage } from '@/lib/error-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Alert } from '@/components/ui/alert';

export function SiteConnectivityForm({
  siteId,
  initial,
  onSaved,
}: {
  siteId: string;
  initial: SiteConnectivity;
  onSaved: () => void;
}) {
  const [type, setType] = useState(initial.type);
  const [hours, setHours] = useState(Math.floor(initial.minutesToSignal / 60));
  const [minutes, setMinutes] = useState(initial.minutesToSignal % 60);
  const [margin, setMargin] = useState(initial.marginMinutes);
  const [submitted, setSubmitted] = useState(false);
  const parsed = siteConnectivitySchema.safeParse({
    type,
    minutesToSignal: type === 'with_signal' ? 0 : hours * 60 + minutes,
    marginMinutes: margin,
  });
  const travelError =
    type === 'without_signal' &&
    (hours < 0 ||
      !Number.isInteger(hours) ||
      minutes < 0 ||
      minutes > 59 ||
      !Number.isInteger(minutes))
      ? 'Ingresá horas enteras y minutos entre 0 y 59'
      : parsed.error?.issues.find((issue) => issue.path[0] === 'minutesToSignal')?.message;
  const marginError = parsed.error?.issues.find(
    (issue) => issue.path[0] === 'marginMinutes',
  )?.message;
  const save = useMutation({
    mutationFn: (conn: SiteConnectivity) =>
      apiPut(
        `/predios/${siteId}/conectividad`,
        conn,
        siteConnectivitySchema,
        siteConnectivitySchema,
      ),
    onSuccess: onSaved,
  });
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (parsed.success && !travelError) save.mutate(parsed.data);
  };
  const time = (date: Date) =>
    date.toLocaleTimeString('es-AR', {
      timeZone: 'UTC',
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
    }) + (date.getUTCDate() === 2 ? ' del día siguiente' : '');
  const helpId = `connectivity-help-${siteId}`;
  const travelErrorId = `connectivity-travel-error-${siteId}`;
  const marginErrorId = `connectivity-margin-error-${siteId}`;

  return (
    <form noValidate onSubmit={submit} aria-label="Conectividad" className="space-y-4">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        <div className="grid gap-2">
          <Label htmlFor={`connectivity-type-${siteId}`}>Tipo de conectividad</Label>
          <NativeSelect
            id={`connectivity-type-${siteId}`}
            value={type}
            onChange={(event) => {
              setType(event.target.value === 'without_signal' ? 'without_signal' : 'with_signal');
              save.reset();
            }}
            aria-describedby={helpId}
          >
            <NativeSelectOption value="with_signal">Con señal</NativeSelectOption>
            <NativeSelectOption value="without_signal">Sin señal</NativeSelectOption>
          </NativeSelect>
        </div>
        {type === 'without_signal' && (
          // Horas y minutos en el mismo renglón que el resto: elegir "Sin señal" no agranda la sección.
          <fieldset className="grid content-start gap-2">
            <legend className="t-label mb-2 text-foreground">Tiempo hasta zona con señal</legend>
            <div className="flex items-center gap-2">
              <Label htmlFor={`connectivity-hours-${siteId}`} className="sr-only">
                Horas
              </Label>
              <Input
                id={`connectivity-hours-${siteId}`}
                type="number"
                min={0}
                max={12}
                step={1}
                value={hours}
                onChange={(event) => {
                  setHours(Number(event.target.value));
                  save.reset();
                }}
                aria-invalid={submitted && Boolean(travelError)}
                aria-describedby={`${helpId} ${travelErrorId}`}
                className="w-20"
              />
              <span aria-hidden="true" className="text-sm text-muted-foreground">
                h
              </span>
              <Label htmlFor={`connectivity-minutes-${siteId}`} className="sr-only">
                Minutos
              </Label>
              <Input
                id={`connectivity-minutes-${siteId}`}
                type="number"
                min={0}
                max={59}
                step={1}
                value={minutes}
                onChange={(event) => {
                  setMinutes(Number(event.target.value));
                  save.reset();
                }}
                aria-invalid={submitted && Boolean(travelError)}
                aria-describedby={`${helpId} ${travelErrorId}`}
                className="ml-2 w-20"
              />
              <span aria-hidden="true" className="text-sm text-muted-foreground">
                min
              </span>
            </div>
            <p
              id={travelErrorId}
              role={submitted && travelError ? 'alert' : undefined}
              className="text-sm text-danger empty:hidden"
            >
              {submitted && travelError}
            </p>
          </fieldset>
        )}
        <div className="grid gap-2">
          <Label htmlFor={`connectivity-margin-${siteId}`}>Margen adicional (minutos)</Label>
          <Input
            id={`connectivity-margin-${siteId}`}
            type="number"
            min={0}
            max={180}
            step={1}
            value={margin}
            onChange={(event) => {
              setMargin(Number(event.target.value));
              save.reset();
            }}
            aria-invalid={submitted && Boolean(marginError)}
            aria-describedby={`${helpId} ${marginErrorId}`}
            className="w-28"
          />
          <p
            id={marginErrorId}
            role={submitted && marginError ? 'alert' : undefined}
            className="text-sm text-danger empty:hidden"
          >
            {submitted && marginError}
          </p>
        </div>
      </div>
      <p id={helpId} aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
        {parsed.success && !travelError
          ? `Un turno de 13 a 15 puede iniciarse desde las ${time(computeStartWindow(new Date('2030-01-01T13:00:00Z'), parsed.data))} y debe sincronizar antes de las ${time(computeSyncDeadline(new Date('2030-01-01T15:00:00Z'), parsed.data))}.`
          : 'Ingresá un tiempo y un margen válidos para ver el ejemplo.'}
      </p>
      {save.isError && (
        <Alert variant="destructive">
          {errorMessage(save.error, 'No se pudo guardar la conectividad. Volvé a intentar.')}
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={save.isPending}>
          {save.isPending ? 'Guardando…' : 'Guardar conectividad'}
        </Button>
        {save.isSuccess && (
          <p role="status" className="text-sm text-success">
            Conectividad guardada
          </p>
        )}
      </div>
    </form>
  );
}

import {
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABELS,
  incidentClassificationSchema,
  incidentReclassificationSchema,
  type IncidentFollowUpStatus,
  type IncidentSeverity,
} from '@garita/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type SyntheticEvent } from 'react';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiPost } from '@/lib/api-client';
import { cn } from '@/lib/utils';

type Visibility = 'client_visible' | 'internal';

const responseSchema = z.object({
  classificationStatus: z.enum(['client_visible', 'internal']),
  decidedAt: z.string(),
});

const VISIBILITY = [
  ['internal', 'Interno', 'Solo lo ve la empresa.'],
  ['client_visible', 'Visible al cliente', 'Lo verá el cliente del predio.'],
] as const;

const choiceClass =
  'relative grid cursor-pointer gap-0.5 rounded-md border-[1.5px] border-input px-3 py-2.5 has-[:checked]:bg-muted has-[:checked]:ring-2 has-[:checked]:ring-inset has-[:checked]:ring-primary has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring';

/** Decisión sobre un incidente: quién lo ve, gravedad, si requiere seguimiento y comentarios. */
export function DecisionForm({
  id,
  reclassify,
  submitLabel,
  onDone,
  onConflict,
  initial,
}: {
  id: string;
  reclassify: boolean;
  /** Al reclasificar, parte de lo decidido para no degradar nada sin querer. */
  initial?: {
    classification: Visibility;
    severity: IncidentSeverity | null;
    followUpStatus: IncidentFollowUpStatus;
    clientNote?: string | null;
  };
  submitLabel?: string;
  onDone: (result: { classification: Visibility; severity: IncidentSeverity }) => void;
  /** Otro usuario lo clasificó antes (409). */
  onConflict?: () => void;
}) {
  const client = useQueryClient();
  const [classification, setClassification] = useState<Visibility>(
    initial?.classification ?? 'internal',
  );
  const [severity, setSeverity] = useState<IncidentSeverity>(initial?.severity ?? 'medium');
  // Solo se abre un seguimiento que no existe; uno abierto o cerrado se maneja desde la ficha.
  const canOpenFollowUp = (initial?.followUpStatus ?? 'none') === 'none';
  const [requiresFollowUp, setRequiresFollowUp] = useState(false);
  const [internalComment, setInternalComment] = useState('');
  const [clientNote, setClientNote] = useState(initial?.clientNote ?? '');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const schema = reclassify ? incidentReclassificationSchema : incidentClassificationSchema;
  const mutation = useMutation({
    mutationFn: (body: { classification: Visibility; severity: IncidentSeverity }) =>
      apiPost(
        `/incidentes/${id}/${reclassify ? 'reclasificar' : 'clasificar'}`,
        body,
        schema,
        responseSchema,
      ),
    onSuccess: async (_data, body) => {
      await client.invalidateQueries({ queryKey: ['incidents'] });
      onDone(body);
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409 && onConflict) {
        await client.invalidateQueries({ queryKey: ['incidents'] });
        onConflict();
      }
    },
  });

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const parsed = schema.safeParse({
      classification,
      severity,
      requiresFollowUp: canOpenFollowUp && requiresFollowUp,
      internalComment,
      ...(classification === 'client_visible' && clientNote.trim() ? { clientNote } : {}),
      ...(reclassify ? { reason } : {}),
    });
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );
      return;
    }
    setErrors({});
    mutation.mutate(parsed.data);
  };

  const field = (name: string, label: string, value: string, set: (v: string) => void) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${name}-${id}`}>{label}</Label>
      <Textarea
        id={`${name}-${id}`}
        rows={2}
        value={value}
        onChange={(event) => {
          set(event.target.value);
        }}
        aria-invalid={!!errors[name]}
        aria-describedby={errors[name] ? `${name}-${id}-error` : undefined}
      />
      {errors[name] && (
        <p id={`${name}-${id}-error`} className="text-sm text-danger">
          {errors[name]}
        </p>
      )}
    </div>
  );

  return (
    <form
      onSubmit={submit}
      aria-label={reclassify ? 'Reclasificar incidente' : 'Clasificar incidente'}
      className="space-y-4"
    >
      <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 text-sm font-semibold">Quién lo ve</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {VISIBILITY.map(([value, title, hint]) => (
              <label key={value} className={choiceClass}>
                <input
                  type="radio"
                  name={`classification-${id}`}
                  value={value}
                  checked={classification === value}
                  onChange={() => {
                    setClassification(value);
                  }}
                  className="absolute opacity-0"
                />
                <span className="font-bold">{title}</span>
                <span className="text-sm text-muted-foreground">{hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 text-sm font-semibold">Gravedad</legend>
          <div className="grid grid-cols-3 gap-2">
            {INCIDENT_SEVERITIES.map((value) => (
              <label key={value} className={cn(choiceClass, 'place-items-center text-center')}>
                <input
                  type="radio"
                  name={`severity-${id}`}
                  value={value}
                  checked={severity === value}
                  onChange={() => {
                    setSeverity(value);
                  }}
                  className="absolute opacity-0"
                />
                <span className="font-bold">{INCIDENT_SEVERITY_LABELS[value]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {canOpenFollowUp && (
        <div className="flex items-center gap-2">
          <Checkbox
            id={`follow-up-${id}`}
            checked={requiresFollowUp}
            onCheckedChange={(checked) => {
              setRequiresFollowUp(checked === true);
            }}
          />
          <label htmlFor={`follow-up-${id}`} className="cursor-pointer">
            Requiere seguimiento de la empresa (queda abierto hasta cerrarlo)
          </label>
        </div>
      )}
      <div className={cn('grid gap-4', classification === 'client_visible' && 'md:grid-cols-2')}>
        {field('internalComment', 'Comentario interno', internalComment, setInternalComment)}
        {classification === 'client_visible' &&
          field('clientNote', 'Nota para el cliente (opcional)', clientNote, setClientNote)}
      </div>
      {reclassify && field('reason', 'Motivo del cambio', reason, setReason)}
      {mutation.isError &&
        !(mutation.error instanceof ApiError && mutation.error.status === 409 && onConflict) && (
          <Alert variant="destructive">
            No se pudo guardar la clasificación. Revisá el estado del incidente.
          </Alert>
        )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending
            ? 'Guardando…'
            : (submitLabel ?? (reclassify ? 'Cambiar clasificación' : 'Confirmar clasificación'))}
        </Button>
      </div>
    </form>
  );
}

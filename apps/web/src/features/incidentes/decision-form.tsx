import {
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABELS,
  incidentClassificationSchema,
  incidentReclassificationSchema,
  type IncidentSeverity,
} from '@garita/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
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
  ['internal', 'Interno', 'Solo lo ve la empresa.', 'I'],
  ['client_visible', 'Visible al cliente', 'Lo verá el cliente del predio.', 'V'],
] as const;

const choiceClass =
  'relative grid cursor-pointer gap-0.5 rounded-md border-[1.5px] border-input px-3 py-2.5 has-[:checked]:bg-muted has-[:checked]:ring-2 has-[:checked]:ring-inset has-[:checked]:ring-primary has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring';

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)
  );
}

/**
 * Decisión sobre un incidente: quién lo ve, gravedad, si requiere seguimiento y comentarios.
 * Con `shortcuts`, I/V eligen visibilidad, 1/2/3 la gravedad y Ctrl+Enter confirma.
 */
export function DecisionForm({
  id,
  reclassify,
  shortcuts = false,
  submitLabel,
  onDone,
  onConflict,
}: {
  id: string;
  reclassify: boolean;
  shortcuts?: boolean;
  submitLabel?: string;
  onDone: (result: { classification: Visibility; severity: IncidentSeverity }) => void;
  /** Otro usuario lo clasificó antes (409). */
  onConflict?: () => void;
}) {
  const client = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [classification, setClassification] = useState<Visibility>('internal');
  const [severity, setSeverity] = useState<IncidentSeverity>('medium');
  const [requiresFollowUp, setRequiresFollowUp] = useState(false);
  const [internalComment, setInternalComment] = useState('');
  const [clientNote, setClientNote] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const schema = reclassify ? incidentReclassificationSchema : incidentClassificationSchema;
  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      apiPost(
        `/incidentes/${id}/${reclassify ? 'reclasificar' : 'clasificar'}`,
        body,
        schema,
        responseSchema,
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['incidents'] });
      onDone({ classification, severity });
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409 && onConflict) {
        await client.invalidateQueries({ queryKey: ['incidents'] });
        onConflict();
      }
    },
  });

  useEffect(() => {
    if (!shortcuts) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        formRef.current?.requestSubmit();
        return;
      }
      if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'i') setClassification('internal');
      else if (key === 'v') setClassification('client_visible');
      else if (key === '1') setSeverity('low');
      else if (key === '2') setSeverity('medium');
      else if (key === '3') setSeverity('high');
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [shortcuts]);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const parsed = schema.safeParse({
      classification,
      severity,
      requiresFollowUp,
      internalComment,
      ...(classification === 'client_visible' && clientNote ? { clientNote } : {}),
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
      ref={formRef}
      onSubmit={submit}
      aria-label={reclassify ? 'Reclasificar incidente' : 'Clasificar incidente'}
      className="space-y-4"
    >
      <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 text-sm font-semibold">Quién lo ve</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {VISIBILITY.map(([value, title, hint, key]) => (
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
                <span className="font-bold">
                  {title}
                  {shortcuts && (
                    <kbd className="ml-2 rounded-sm border border-border px-1 text-sm font-normal text-muted-foreground">
                      {key}
                    </kbd>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">{hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 text-sm font-semibold">Gravedad</legend>
          <div className="grid grid-cols-3 gap-2">
            {INCIDENT_SEVERITIES.map((value, index) => (
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
                <span className="font-bold">
                  {INCIDENT_SEVERITY_LABELS[value]}
                  {shortcuts && (
                    <kbd className="ml-1.5 rounded-sm border border-border px-1 text-sm font-normal text-muted-foreground">
                      {index + 1}
                    </kbd>
                  )}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
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
        {shortcuts && (
          <p className="text-sm text-muted-foreground">
            Atajos: <kbd>↑</kbd>/<kbd>↓</kbd> cambiar incidente · <kbd>I</kbd>/<kbd>V</kbd> quién lo
            ve · <kbd>1</kbd>–<kbd>3</kbd> gravedad · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> confirmar
          </p>
        )}
      </div>
    </form>
  );
}

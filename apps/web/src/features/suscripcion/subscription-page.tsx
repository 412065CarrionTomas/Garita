import { GraceActions } from './grace-actions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import {
  cancelSubscriptionRequestSchema,
  createSubscriptionRequestSchema,
  createSubscriptionResponseSchema,
  plansResponseSchema,
  subscriptionResponseSchema,
  guardSelectionRequiredSchema,
  type GuardSelection,
  type GuardSelectionRequired,
  type SubscriptionChargeStatus,
  type SubscriptionResponse,
  type SubscriptionStatus,
} from '@garita/shared';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Stamp } from '@/components/stamp';
import { StatusBadge, type StatusTone } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, apiGet, apiPost } from '@/lib/api-client';
import { errorMessage } from '@/lib/error-message';
import { useAuth } from '../auth/auth-context';
import { openCheckoutTab, sendToCheckout } from './checkout-redirect';
import { GuardSelectionStep } from './guard-selection-step';

const SUBSCRIPTION_STATUS: Record<SubscriptionStatus, { label: string; tone: StatusTone }> = {
  pending: { label: 'Falta autorizar', tone: 'neutral' },
  authorized: { label: 'Activa', tone: 'success' },
  paused: { label: 'Pausada', tone: 'warning' },
  cancelled: { label: 'Cancelada', tone: 'neutral' },
};

const CHARGE_STATUS: Record<SubscriptionChargeStatus, { label: string; tone: StatusTone }> = {
  approved: { label: 'Aprobado', tone: 'success' },
  rejected: { label: 'Rechazado', tone: 'danger' },
  pending: { label: 'Pendiente', tone: 'neutral' },
};

/** Mercado Pago's status_detail codes, in words the admin can act on. */
const PAYMENT_DETAIL: Record<string, string> = {
  accredited: 'Acreditado',
  cc_rejected_insufficient_amount: 'Fondos insuficientes',
  cc_rejected_bad_filled_security_code: 'Código de seguridad incorrecto',
  cc_rejected_bad_filled_date: 'Fecha de vencimiento incorrecta',
  cc_rejected_bad_filled_card_number: 'Número de tarjeta incorrecto',
  cc_rejected_bad_filled_other: 'Datos de la tarjeta incorrectos',
  cc_rejected_call_for_authorize: 'El banco pide autorizar el pago',
  cc_rejected_card_disabled: 'Tarjeta deshabilitada',
  cc_rejected_duplicated_payment: 'Pago duplicado',
  cc_rejected_high_risk: 'Rechazado por prevención de fraude',
  cc_rejected_max_attempts: 'Demasiados intentos con esta tarjeta',
  cc_rejected_other_reason: 'El banco rechazó el pago',
};
const paymentDetail = (code: string | null) => (code ? (PAYMENT_DETAIL[code] ?? code) : '—');

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
const formatMoney = (amount: string) => money.format(Number(amount));
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function SubscriptionPage() {
  const [chargePage, setChargePage] = useState(1);
  const subscription = useQuery({
    queryKey: chargePage === 1 ? ['suscripcion'] : ['suscripcion', chargePage],
    queryFn: () =>
      apiGet(
        chargePage === 1 ? '/suscripcion' : `/suscripcion?chargePage=${chargePage}`,
        subscriptionResponseSchema,
      ),
    // Always stale: coming back from the Mercado Pago tab refetches, and the API syncs on read.
    staleTime: 0,
  });
  const current = subscription.data?.subscription;
  const canSubscribe = !current || current.status === 'pending' || current.status === 'cancelled';

  return (
    <section aria-labelledby="subscription-title" className="space-y-6">
      <PageHeader
        id="subscription-title"
        title="Suscripción y cobros"
        description="Elegí tu plan y autorizá el débito automático mensual en Mercado Pago."
      />
      <GraceActions />
      {subscription.isPending ? (
        <div role="status" className="space-y-3">
          <span className="sr-only">Cargando la suscripción…</span>
          <Skeleton className="h-32 w-full" />
        </div>
      ) : subscription.isError ? (
        <Alert variant="destructive">No se pudo cargar la suscripción.</Alert>
      ) : (
        <>
          {current && (
            <CurrentSubscription
              subscription={current}
              chargePage={chargePage}
              onPageChange={setChargePage}
            />
          )}
          {canSubscribe && (
            <SubscribeForm
              trialEndsAt={subscription.data.trialEndsAt}
              lastPayerEmail={current?.payerEmail}
            />
          )}
        </>
      )}
    </section>
  );
}

function CurrentSubscription({
  subscription,
  chargePage,
  onPageChange,
}: {
  subscription: NonNullable<SubscriptionResponse['subscription']>;
  chargePage: number;
  onPageChange: (page: number) => void;
}) {
  const cancelAt = subscription.status === 'cancelled' ? null : subscription.cancelAt;
  // Mercado Pago cancels the subscription itself when the first payment is rejected.
  const rejected =
    subscription.lastFailureReason !== null &&
    (subscription.status === 'pending' ||
      (subscription.status === 'cancelled' &&
        !(
          subscription.hasApprovedCharge ??
          subscription.charges.some((charge) => charge.status === 'approved')
        )));
  const status = cancelAt
    ? { label: `Activa hasta el ${formatDate(cancelAt)}`, tone: 'neutral' as const }
    : rejected
      ? { label: 'No se activó', tone: 'neutral' as const }
      : SUBSCRIPTION_STATUS[subscription.status];
  return (
    <Card>
      <CardHeader>
        <h2 className="t-headline">Tu suscripción</h2>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="t-label text-muted-foreground">Plan</dt>
            <dd className="font-semibold">{subscription.plan.name}</dd>
          </div>
          <div>
            <dt className="t-label text-muted-foreground">Estado</dt>
            <dd>
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            </dd>
          </div>
          <div>
            <dt className="t-label text-muted-foreground">Próximo cobro</dt>
            <dd>
              {cancelAt ? (
                'Sin más cobros'
              ) : subscription.status === 'authorized' && subscription.nextChargeAt ? (
                <Stamp>{formatDate(subscription.nextChargeAt)}</Stamp>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt className="t-label text-muted-foreground">Cuenta de Mercado Pago</dt>
            <dd className="break-all">{subscription.payerEmail}</dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">
          Tu plan permite hasta {subscription.plan.maxGuards} vigiladores activos o con invitación
          pendiente. Si alcanzaste el límite y necesitás ampliarlo, contactá a la plataforma para
          subir de plan.
        </p>
        {rejected ? (
          <Alert variant="destructive">
            Mercado Pago rechazó el pago: {paymentDetail(subscription.lastFailureReason)}. La
            suscripción no se activó. Para intentar con otra tarjeta, volvé a suscribirte desde
            abajo: en la página de Mercado Pago ya no se puede reintentar.
          </Alert>
        ) : (
          subscription.status === 'pending' && (
            <p className="text-sm text-muted-foreground">
              Falta autorizar el débito en Mercado Pago. Si cerraste esa página, volvé a suscribirte
              desde abajo.
            </p>
          )
        )}
        {cancelAt ? (
          <RevertCancellation cancelAt={cancelAt} />
        ) : (
          subscription.status === 'authorized' && (
            <CancelSubscription paidUntil={subscription.nextChargeAt} />
          )
        )}
        <div className="space-y-2">
          <h3 className="t-label text-muted-foreground">Historial de cobros</h3>
          {subscription.charges.length === 0 ? (
            <EmptyState
              title="Todavía no hay cobros"
              description="Cada débito mensual aparece acá con su resultado."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Monto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Detalle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscription.charges.map((charge) => (
                  <TableRow key={charge.id}>
                    <TableCell>
                      {charge.chargedAt ? <Stamp>{formatDate(charge.chargedAt)}</Stamp> : '—'}
                    </TableCell>
                    <TableCell className="t-numeral">{formatMoney(charge.amount)}</TableCell>
                    <TableCell>
                      <StatusBadge tone={CHARGE_STATUS[charge.status].tone}>
                        {CHARGE_STATUS[charge.status].label}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>{paymentDetail(charge.statusDetail)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        {(chargePage > 1 || subscription.hasMoreCharges) && (
          <nav aria-label="Páginas del historial" className="flex items-center justify-end gap-3">
            <Button
              variant="outline"
              disabled={chargePage === 1}
              onClick={() => {
                onPageChange(chargePage - 1);
              }}
            >
              Anterior
            </Button>
            <span>Página {chargePage}</span>
            <Button
              variant="outline"
              disabled={!subscription.hasMoreCharges}
              onClick={() => {
                onPageChange(chargePage + 1);
              }}
            >
              Siguiente
            </Button>
          </nav>
        )}
      </CardContent>
    </Card>
  );
}

function useUpdateSubscription(
  mutationFn: () => Promise<SubscriptionResponse>,
  onDone?: () => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      queryClient.setQueryData(['suscripcion'], data);
      // The response is page 1; any other page of charges on screen has to be read again.
      void queryClient.invalidateQueries({
        queryKey: ['suscripcion'],
        predicate: (query) => query.queryKey.length > 1,
      });
      onDone?.();
    },
  });
}

function CancelSubscription({ paidUntil }: { paidUntil: string | null }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const cancel = useUpdateSubscription(
    () =>
      apiPost(
        '/suscripcion/cancelar',
        reason.trim() ? { reason: reason.trim() } : {},
        cancelSubscriptionRequestSchema,
        subscriptionResponseSchema,
      ),
    () => {
      setOpen(false);
    },
  );
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <div className="flex justify-end">
        <AlertDialogTrigger asChild>
          <Button variant="outline">Cancelar suscripción</Button>
        </AlertDialogTrigger>
      </div>
      <AlertDialogContent className="space-y-4">
        <AlertDialogTitle>Cancelar la suscripción</AlertDialogTitle>
        <AlertDialogDescription>
          {paidUntil
            ? `El servicio sigue funcionando hasta el ${formatDate(paidUntil)} y no se hacen más cobros. Después, la cuenta queda suspendida.`
            : 'No se hacen más cobros y, al terminar el ciclo pagado, la cuenta queda suspendida.'}{' '}
          Podés revertir la cancelación antes de esa fecha.
        </AlertDialogDescription>
        <div className="grid gap-2">
          <Label htmlFor="cancel-reason">Motivo (opcional)</Label>
          <Textarea
            id="cancel-reason"
            maxLength={500}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </div>
        {cancel.error && <Alert variant="destructive">{errorMessage(cancel.error)}</Alert>}
        <div className="flex flex-wrap justify-end gap-2">
          <AlertDialogCancel asChild>
            <Button variant="outline">Volver</Button>
          </AlertDialogCancel>
          <Button
            disabled={cancel.isPending}
            onClick={() => {
              cancel.mutate();
            }}
          >
            {cancel.isPending ? 'Cancelando…' : 'Cancelar suscripción'}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RevertCancellation({ cancelAt }: { cancelAt: string }) {
  const revert = useUpdateSubscription(() =>
    apiPost('/suscripcion/revertir-cancelacion', {}, z.object({}), subscriptionResponseSchema),
  );
  return (
    <div className="space-y-3">
      <Alert>
        Cancelaste la suscripción. El servicio sigue hasta el {formatDate(cancelAt)} y después la
        cuenta queda suspendida. Si cambiaste de idea, podés revertirlo hasta esa fecha.
      </Alert>
      {revert.error && <Alert variant="destructive">{errorMessage(revert.error)}</Alert>}
      <div className="flex justify-end">
        <Button
          variant="outline"
          disabled={revert.isPending}
          onClick={() => {
            revert.mutate();
          }}
        >
          {revert.isPending ? 'Revirtiendo…' : 'Revertir cancelación'}
        </Button>
      </div>
    </div>
  );
}

const optionClass =
  'relative grid cursor-pointer gap-0.5 rounded-md border-[1.5px] border-input px-3.5 py-3 has-[:checked]:bg-muted has-[:checked]:ring-2 has-[:checked]:ring-inset has-[:checked]:ring-primary has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring';

function SubscribeForm({
  trialEndsAt,
  lastPayerEmail,
}: {
  trialEndsAt: string | null;
  lastPayerEmail: string | undefined;
}) {
  const { user } = useAuth();
  const plans = useQuery({
    queryKey: ['planes'],
    queryFn: () => apiGet('/planes', plansResponseSchema),
  });
  const [planId, setPlanId] = useState('');
  const [payerEmail, setPayerEmail] = useState(lastPayerEmail ?? user?.email ?? '');
  const [keepTrial, setKeepTrial] = useState(true);
  const [formError, setFormError] = useState('');
  const [requiredSelection, setRequiredSelection] = useState<GuardSelectionRequired | null>(null);
  const [guardSelection, setGuardSelection] = useState<GuardSelection>({
    guardsToKeep: [],
    shiftDecisions: [],
  });
  const inTrial = trialEndsAt !== null && new Date(trialEndsAt) > new Date();

  const queryClient = useQueryClient();
  const subscribe = useMutation({
    mutationFn: ({ body }: { body: unknown; tab: Window | null }) =>
      apiPost(
        '/suscripcion',
        body,
        createSubscriptionRequestSchema,
        createSubscriptionResponseSchema,
      ),
    onSuccess: ({ initPoint }, { tab }) => {
      // The card is loaded on Mercado Pago's page; this tab refreshes when the admin comes back.
      if (sendToCheckout(tab, initPoint)) {
        void queryClient.invalidateQueries({ queryKey: ['suscripcion'] });
      }
    },
    onError: (error, { tab }) => {
      tab?.close();
      const required = guardSelectionRequiredSchema.safeParse(
        error instanceof ApiError ? error.body : null,
      );
      if (required.success) {
        setRequiredSelection(required.data);
        setGuardSelection({
          guardsToKeep: [],
          shiftDecisions: required.data.guards.map((guard) => ({
            guardId: guard.id,
            shiftAction: 'unassign',
            confirmUnassignedCount: guard.futureShiftCount,
          })),
        });
      }
    },
  });

  if (plans.isPending)
    return (
      <div role="status">
        <span className="sr-only">Cargando planes…</span>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (plans.isError) return <Alert variant="destructive">No se pudieron cargar los planes.</Alert>;

  return (
    <Card>
      <CardHeader>
        <h2 className="t-headline">Elegí tu plan</h2>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            const body = {
              planId,
              payerEmail,
              keepTrial: inTrial && keepTrial,
              ...(requiredSelection ? { guardSelection } : {}),
            };
            const parsed = createSubscriptionRequestSchema.safeParse(body);
            if (!parsed.success) {
              setFormError(planId ? 'Ingresá un email válido.' : 'Elegí un plan.');
              return;
            }
            if (requiredSelection && guardSelection.guardsToKeep.length === 0) {
              setFormError('Elegí al menos un vigilador que siga activo.');
              return;
            }
            setFormError('');
            subscribe.mutate({ body: parsed.data, tab: openCheckoutTab() });
          }}
        >
          <fieldset className="space-y-2">
            <legend className="t-label mb-1 text-muted-foreground">Plan</legend>
            <div className="grid gap-2.5 sm:grid-cols-3">
              {plans.data.map((plan) => (
                <label key={plan.id} className={optionClass}>
                  <input
                    type="radio"
                    name="plan"
                    value={plan.id}
                    checked={planId === plan.id}
                    onChange={() => {
                      setPlanId(plan.id);
                      setRequiredSelection(null);
                    }}
                    className="absolute opacity-0"
                  />
                  <span className="font-bold">{plan.name}</span>
                  <span className="t-numeral">{formatMoney(plan.monthlyPrice)}</span>
                  <span className="text-sm text-muted-foreground">
                    por mes, hasta {plan.maxGuards} vigiladores
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid max-w-md gap-2">
            <Label htmlFor="payer-email">Email de tu cuenta de Mercado Pago</Label>
            <Input
              id="payer-email"
              type="email"
              required
              aria-describedby="payer-email-hint"
              value={payerEmail}
              onChange={(event) => {
                setPayerEmail(event.target.value);
              }}
            />
            <p id="payer-email-hint" className="text-sm text-muted-foreground">
              Tiene que ser la cuenta con la que vas a pagar; puede ser distinta de tu email de
              Garita.
            </p>
          </div>

          {inTrial && (
            <fieldset className="space-y-2">
              <legend className="t-label mb-1 text-muted-foreground">Prueba gratis</legend>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <label className={optionClass}>
                  <input
                    type="radio"
                    name="trial"
                    checked={keepTrial}
                    onChange={() => {
                      setKeepTrial(true);
                    }}
                    className="absolute opacity-0"
                  />
                  <span className="font-bold">Seguir con la prueba</span>
                  <span className="text-sm text-muted-foreground">
                    El primer cobro es el {formatDate(trialEndsAt)}.
                  </span>
                </label>
                <label className={optionClass}>
                  <input
                    type="radio"
                    name="trial"
                    checked={!keepTrial}
                    onChange={() => {
                      setKeepTrial(false);
                    }}
                    className="absolute opacity-0"
                  />
                  <span className="font-bold">Pagar ahora</span>
                  <span className="text-sm text-muted-foreground">
                    Se cobra hoy y terminan los días de prueba que quedan.
                  </span>
                </label>
              </div>
            </fieldset>
          )}

          {requiredSelection && (
            <GuardSelectionStep
              required={requiredSelection}
              value={guardSelection}
              onChange={setGuardSelection}
            />
          )}
          {formError && <Alert variant="destructive">{formError}</Alert>}
          {subscribe.error && (
            <Alert variant="destructive">
              {subscribe.error instanceof ApiError && subscribe.error.status === 502
                ? 'Mercado Pago no aceptó la suscripción. Revisá que el email sea el de tu cuenta de Mercado Pago.'
                : guardSelectionRequiredSchema.safeParse(
                      subscribe.error instanceof ApiError ? subscribe.error.body : null,
                    ).success
                  ? 'Elegí qué vigiladores siguen activos y confirmá la decisión sobre sus turnos antes de continuar.'
                  : errorMessage(subscribe.error, 'Tu empresa ya tiene una suscripción activa.')}
            </Alert>
          )}
          {subscribe.isSuccess && (
            <Alert role="status">
              Abrimos Mercado Pago en otra pestaña. Completá el pago ahí y volvé a esta pestaña: el
              estado se actualiza solo.
            </Alert>
          )}
          <div className="flex justify-end">
            <Button disabled={subscribe.isPending}>
              {subscribe.isPending ? 'Abriendo Mercado Pago…' : 'Suscribirme'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

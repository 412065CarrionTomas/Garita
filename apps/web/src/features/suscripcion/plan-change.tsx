import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  planChangeHistorySchema,
  planChangeRequestSchema,
  planChangeResponseSchema,
  planChangeSimulationSchema,
  plansResponseSchema,
  guardSelectionRequiredSchema,
  type GuardSelection,
  type GuardSelectionRequired,
  type SubscriptionResponse,
} from '@garita/shared';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/status-badge';
import { ApiError, apiGet, apiPost } from '@/lib/api-client';
import { errorMessage } from '@/lib/error-message';
import { GuardSelectionStep } from './guard-selection-step';
import { openCheckoutTab, sendToCheckout } from './checkout-redirect';

const date = (iso: string) => new Date(iso).toLocaleString('es-AR');
const money = (amount: string) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(amount));
const changeLabels = {
  upgrade: 'Subida de plan',
  downgrade_scheduled: 'Baja programada',
  downgrade_applied: 'Baja aplicada',
  cancellation: 'Cancelación',
  cancellation_reverted: 'Cancelación revertida',
};

export function PlanChange({
  subscription,
}: {
  subscription: NonNullable<SubscriptionResponse['subscription']>;
}) {
  const client = useQueryClient();
  const [planId, setPlanId] = useState('');
  const [selection, setSelection] = useState<GuardSelection>({
    guardsToKeep: [],
    shiftDecisions: [],
  });
  const [required, setRequired] = useState<GuardSelectionRequired | null>(null);
  const [message, setMessage] = useState('');
  const history = useQuery({
    queryKey: ['suscripcion', 'cambios'],
    queryFn: () => apiGet('/suscripcion/historial', planChangeHistorySchema),
    refetchInterval: 10_000,
  });
  const plans = useQuery({
    queryKey: ['planes'],
    queryFn: () => apiGet('/planes', plansResponseSchema),
  });
  const simulation = useQuery({
    queryKey: ['simular-cambio-plan', subscription.id, subscription.plan.id, planId],
    queryFn: () =>
      apiGet(
        `/suscripcion/cambio-plan/simular?plan=${encodeURIComponent(planId)}`,
        planChangeSimulationSchema,
      ),
    enabled: Boolean(planId),
    staleTime: 0,
  });
  const needed = required ?? simulation.data?.guardSelectionRequired ?? null;
  const change = useMutation({
    mutationFn: (_tab: Window | null) =>
      apiPost(
        '/suscripcion/cambio-plan',
        { planId, ...(needed ? { guardSelection: selection } : {}) },
        planChangeRequestSchema,
        planChangeResponseSchema,
      ),
    onSuccess: (result, tab) => {
      if (result.initPoint) sendToCheckout(tab, result.initPoint);
      else {
        tab?.close();
        setMessage(`Cambio registrado. Rige desde el ${date(result.effectiveAt)}.`);
      }
      setPlanId('');
      setRequired(null);
      void client.invalidateQueries({ queryKey: ['suscripcion'] });
      void client.invalidateQueries({ queryKey: ['cuenta'] });
    },
    onError: (error, tab) => {
      tab?.close();
      const result = guardSelectionRequiredSchema.safeParse(
        error instanceof ApiError ? error.body : null,
      );
      if (result.success) {
        setRequired(result.data);
        setSelection({ guardsToKeep: [], shiftDecisions: [] });
      }
    },
  });
  const canChange = subscription.status === 'authorized' && !subscription.cancelAt;
  const pendingPayment = history.data?.payments.some((payment) => payment.status === 'pending');
  return (
    <Card>
      <CardHeader>
        <h2 className="t-headline">Cambio de plan e historial</h2>
      </CardHeader>
      <CardContent className="space-y-5">
        {history.isError && (
          <Alert variant="destructive">No se pudo cargar el historial de cambios.</Alert>
        )}
        {history.data?.pendingPlan && (
          <Alert>
            Baja a {history.data.pendingPlan.name} programada para el{' '}
            {history.data.pendingEffectiveAt
              ? date(history.data.pendingEffectiveAt)
              : 'pr�ximo ciclo'}
            . Las altas ya respetan el cupo menor. Elegí el plan vigente para anularla.
          </Alert>
        )}
        {canChange && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!simulation.data || change.isPending) return;
              setMessage('');
              change.mutate(
                simulation.data.type === 'upgrade' && simulation.data.amount !== '0.00'
                  ? openCheckoutTab()
                  : null,
              );
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="change-plan">Nuevo plan</Label>
              <NativeSelect
                id="change-plan"
                value={planId}
                disabled={change.isPending || Boolean(pendingPayment)}
                onChange={(event) => {
                  setPlanId(event.target.value);
                  setRequired(null);
                  setSelection({ guardsToKeep: [], shiftDecisions: [] });
                  change.reset();
                }}
              >
                <NativeSelectOption value="">Elegí un plan</NativeSelectOption>
                {plans.data
                  ?.filter((plan) => plan.id !== subscription.plan.id || history.data?.pendingPlan)
                  .map((plan) => (
                    <NativeSelectOption key={plan.id} value={plan.id}>
                      {plan.name} — {money(plan.monthlyPrice)} por mes, hasta {plan.maxGuards}{' '}
                      vigiladores
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </div>
            {plans.isError && (
              <Alert variant="destructive">No se pudieron cargar los planes.</Alert>
            )}
            {planId && simulation.isPending && <p role="status">Calculando diferencia…</p>}
            {planId && simulation.isError && (
              <Alert variant="destructive">{errorMessage(simulation.error)}</Alert>
            )}
            {planId && simulation.data && (
              <div role="status" className="space-y-2">
                <p>
                  Diferencia a pagar: {money(simulation.data.amount)}. Rige desde el{' '}
                  {date(simulation.data.effectiveAt)}.
                </p>
                <p>
                  {simulation.data.type === 'upgrade' && simulation.data.amount !== '0.00'
                    ? 'El cupo aumenta cuando Mercado Pago aprueba el pago; luego se actualiza el débito mensual.'
                    : simulation.data.type === 'downgrade'
                      ? 'Sin reintegro. El plan y las bajas de vigiladores se aplican en la fecha indicada.'
                      : 'No se genera un cobro de diferencia.'}
                </p>
              </div>
            )}
            {needed && (
              <div className="space-y-3">
                <p>
                  En este cambio, los vigiladores elegidos siguen activos y los demás se desactivan
                  desde el próximo ciclo indicado arriba.
                </p>
                <GuardSelectionStep required={needed} value={selection} onChange={setSelection} />
              </div>
            )}
            {change.error && <Alert variant="destructive">{errorMessage(change.error)}</Alert>}
            <Button
              disabled={
                !planId ||
                !simulation.data ||
                simulation.isFetching ||
                change.isPending ||
                Boolean(pendingPayment) ||
                Boolean(needed && selection.guardsToKeep.length === 0)
              }
            >
              {change.isPending ? 'Registrando…' : 'Confirmar cambio de plan'}
            </Button>
          </form>
        )}
        {message && <Alert role="status">{message}</Alert>}
        {history.data?.payments.map((payment) => (
          <div key={payment.id} className="space-y-2">
            <StatusBadge tone={payment.status === 'rejected' ? 'danger' : 'neutral'}>
              {`Diferencia ${money(payment.amount)}: ${
                payment.status === 'approved'
                  ? 'Aprobada'
                  : payment.status === 'pending'
                    ? 'Pendiente'
                    : 'Rechazada'
              }`}
            </StatusBadge>
            {payment.status === 'pending' && (
              <p>
                El enlace vence el {date(payment.expiresAt)}. No se puede pedir otro cambio hasta
                que se resuelva.
              </p>
            )}
            {payment.rejectionReason && <p role="alert">Motivo: {payment.rejectionReason}</p>}
            {payment.amountUpdatePending && (
              <p role="status">
                El cupo nuevo ya está disponible. Falta actualizar el débito mensual; se reintenta
                automáticamente.
              </p>
            )}
          </div>
        ))}
        <h3 className="t-title">Historial de cambios</h3>
        {history.data?.changes.length === 0 && <p>Todavía no hay cambios registrados.</p>}
        {Boolean(history.data?.changes.length) && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cambio</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Rige desde</TableHead>
                <TableHead>Administrador</TableHead>
                <TableHead>Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.data?.changes.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{changeLabels[item.type]}</TableCell>
                  <TableCell>{item.planName}</TableCell>
                  <TableCell>{date(item.effectiveAt)}</TableCell>
                  <TableCell>{item.adminName}</TableCell>
                  <TableCell>{item.reason ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

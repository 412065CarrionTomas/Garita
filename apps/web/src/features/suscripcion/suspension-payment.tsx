import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  graceRetryResponseSchema,
  guardSelectionRequiredSchema,
  payOverdueRequestSchema,
  plansResponseSchema,
  type GuardSelection,
  type GuardSelectionRequired,
} from '@garita/shared';
import { ApiError, apiGet, apiPost } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { errorMessage } from '@/lib/error-message';
import { useAccountState } from '../cuenta/use-account-state';
import { GuardSelectionStep } from './guard-selection-step';
import { openCheckoutTab, sendToCheckout } from './checkout-redirect';

export function SuspensionPayment({ amountDue }: { amountDue?: string }) {
  const account = useAccountState(true);
  const suspended = account.data?.status === 'suspended';
  const [planId, setPlanId] = useState('');
  const [required, setRequired] = useState<GuardSelectionRequired | null>(null);
  const [selection, setSelection] = useState<GuardSelection>({
    guardsToKeep: [],
    shiftDecisions: [],
  });
  const plans = useQuery({
    queryKey: ['planes'],
    queryFn: () => apiGet('/planes', plansResponseSchema),
    enabled: suspended,
  });
  const pay = useMutation({
    mutationFn: async (tab: Window | null) => {
      try {
        const result = await apiPost(
          '/suscripcion/pagar-adeudado',
          {
            ...(planId ? { planId } : {}),
            ...(required ? { guardSelection: selection } : {}),
          },
          payOverdueRequestSchema,
          graceRetryResponseSchema,
        );
        sendToCheckout(tab, result.initPoint);
      } catch (error) {
        tab?.close();
        const needed = guardSelectionRequiredSchema.safeParse(
          error instanceof ApiError ? error.body : undefined,
        );
        if (needed.success) setRequired(needed.data);
        throw error;
      }
    },
  });
  if (!suspended) return null;
  if (account.data?.suspensionReason !== 'grace_expired')
    return (
      <Alert role="status">
        La cuenta está suspendida. Elegí un plan para volver a suscribirte.
      </Alert>
    );
  return (
    <Card>
      <CardHeader>
        <h2 className="text-title">Pagar lo adeudado</h2>
      </CardHeader>
      <CardContent className="space-y-4">
        <p>
          Debés el ciclo completo: ARS {amountDue ?? 'Por confirmar'}, incluidos los días de gracia
          y suspensión. El pago no modifica la fecha prevista de los próximos cobros.
        </p>
        <Label htmlFor="suspension-plan">Plan al reactivar</Label>
        <NativeSelect
          id="suspension-plan"
          value={planId}
          onChange={(event) => {
            setPlanId(event.target.value);
            setRequired(null);
          }}
        >
          <NativeSelectOption value="">Conservar mi plan</NativeSelectOption>
          {plans.data?.map((plan) => (
            <NativeSelectOption key={plan.id} value={plan.id}>
              {plan.name} · hasta {plan.maxGuards} vigiladores
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {required && (
          <GuardSelectionStep required={required} value={selection} onChange={setSelection} />
        )}
        <Button
          disabled={pay.isPending}
          onClick={() => {
            pay.mutate(openCheckoutTab());
          }}
        >
          Pagar lo adeudado
        </Button>
        <p role="status">
          {pay.isPending
            ? 'Preparando el pago…'
            : pay.isSuccess
              ? 'Pago abierto en Mercado Pago. Esperando su aprobación.'
              : ''}
        </p>
        {pay.error && !required && <Alert variant="destructive">{errorMessage(pay.error)}</Alert>}
      </CardContent>
    </Card>
  );
}

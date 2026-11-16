import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  gracePaymentMethodResponseSchema,
  graceRetryRequestSchema,
  graceRetryResponseSchema,
} from '@garita/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { apiGet, apiPost } from '@/lib/api-client';
import { errorMessage } from '@/lib/error-message';
import { useAuth } from '../auth/auth-context';
import { useAccountState } from '../cuenta/use-account-state';
import { openCheckoutTab, sendToCheckout } from './checkout-redirect';

export function GraceActions() {
  const { user } = useAuth();
  const account = useAccountState(user?.role === 'admin');
  const queryClient = useQueryClient();
  const method = useMutation({
    mutationFn: async (tab: Window | null) => {
      try {
        const result = await apiGet('/suscripcion/medio-de-pago', gracePaymentMethodResponseSchema);
        sendToCheckout(tab, result.url);
      } catch (error) {
        tab?.close();
        throw error;
      }
    },
  });
  const retry = useMutation({
    mutationFn: async (tab: Window | null) => {
      try {
        const result = await apiPost(
          '/suscripcion/reintentar-cobro',
          {},
          graceRetryRequestSchema,
          graceRetryResponseSchema,
        );
        sendToCheckout(tab, result.initPoint);
        return result;
      } catch (error) {
        tab?.close();
        throw error;
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cuenta', 'estado'] });
      await queryClient.invalidateQueries({ queryKey: ['suscripcion'] });
    },
  });
  if (user?.role !== 'admin' || account.data?.status !== 'grace') return null;
  return (
    <Card>
      <CardHeader>
        <h2 className="text-title">Regularizar el cobro</h2>
      </CardHeader>
      <CardContent className="space-y-4">
        <p>En Mercado Pago, ingresá a Suscripciones, elegí Garita y cambiá el medio de pago.</p>
        <p>
          Mercado Pago también reintenta el cobro por su cuenta durante unos días; si ya cambiaste
          el medio de pago podés esperar ese reintento.
        </p>
        <p>
          También podés pagar el ciclo adeudado con un pago único. Si ambos cobros se aprueban,
          contactá al administrador del sistema para gestionar el reintegro del duplicado.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            disabled={method.isPending}
            onClick={() => {
              retry.reset();
              method.mutate(openCheckoutTab());
            }}
          >
            Cambiar medio de pago
          </Button>
          <Button
            disabled={retry.isPending}
            onClick={() => {
              method.reset();
              retry.mutate(openCheckoutTab());
            }}
          >
            Reintentar cobro
          </Button>
        </div>
        <p role="status">
          {retry.isPending
            ? 'Consultando el cobro en Mercado Pago…'
            : retry.isSuccess
              ? 'Pago único abierto en Mercado Pago. Esperando su aprobación.'
              : 'El reintento abre un pago único en Mercado Pago.'}
        </p>
        {(retry.error ?? method.error) && (
          <Alert variant="destructive">{errorMessage(retry.error ?? method.error)}</Alert>
        )}
      </CardContent>
    </Card>
  );
}

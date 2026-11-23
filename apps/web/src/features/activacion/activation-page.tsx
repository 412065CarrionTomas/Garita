import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { invitationRedeemResponseSchema } from '@garita/shared';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { env } from '@/config/env';
import { AuthLayout } from '../auth/auth-layout';

const failureSchema = z.object({
  reason: z.enum(['invalid', 'replaced', 'used', 'expired', 'rate_limited']),
});
const failureMessages = {
  invalid: 'Esta invitación no es válida. Pedile a tu administrador que te envíe una nueva',
  replaced: 'Esta invitación fue reemplazada. Pedile a tu administrador que te envíe una nueva',
  used: 'Esta invitación ya fue usada. Ingresá con tu cuenta.',
  expired: 'Esta invitación venció. Pedile a tu administrador que te envíe una nueva',
  rate_limited: 'Demasiados intentos. Esperá un minuto y volvé a intentarlo.',
};

export function ActivationPage() {
  const [params] = useSearchParams();
  const [message, setMessage] = useState(() =>
    params.get('token')
      ? 'Validando invitación…'
      : 'Falta el enlace de invitación. Pedile a tu administrador que te envíe uno nuevo.',
  );
  const [passwordSetupUrl, setPasswordSetupUrl] = useState<string | null>(null);
  useEffect(() => {
    const token = params.get('token');
    if (!token) return;
    void fetch(`${env.VITE_API_URL}/invitaciones/canjear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        if (response.status === 410 || response.status === 429) {
          const body = failureSchema.parse(await response.json());
          setMessage(failureMessages[body.reason]);
          return;
        }
        if (!response.ok) throw new Error();
        const data = invitationRedeemResponseSchema.parse(await response.json());
        setMessage(
          data.role === 'guard'
            ? 'Una vez definida tu contraseña, ingresá desde la app móvil de Garita.'
            : 'Invitación válida. Definí tu contraseña para ingresar.',
        );
        setPasswordSetupUrl(data.passwordSetupUrl);
      })
      .catch(() => {
        setMessage('No se pudo validar la invitación. Pedile ayuda a tu administrador.');
      });
  }, [params]);
  return (
    <AuthLayout title="Activar cuenta">
      <div className="space-y-4">
        <Alert
          role="status"
          variant={
            passwordSetupUrl || message === 'Validando invitación…' ? 'default' : 'destructive'
          }
          className={
            passwordSetupUrl || message === 'Validando invitación…'
              ? 'border-info/30 bg-info-soft text-info'
              : undefined
          }
        >
          {message}
        </Alert>
        {passwordSetupUrl && (
          <Button asChild size="lg" className="w-full">
            <a href={passwordSetupUrl}>Definir contraseña</a>
          </Button>
        )}
      </div>
    </AuthLayout>
  );
}

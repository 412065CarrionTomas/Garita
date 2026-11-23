import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { invitationRedeemResponseSchema, LEGAL_VERSION } from '@garita/shared';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { env } from '@/config/env';
import { AuthLayout } from '../auth/auth-layout';
import { LegalConsent } from '../legal/legal-pages';

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

const PENDING_MESSAGE = 'Para activar tu cuenta, leé y aceptá los Términos y Condiciones.';
const VALIDATING_MESSAGE = 'Validando invitación…';
const OUTDATED_TERMS_MESSAGE =
  'Hay una versión más reciente de los términos. Recargá la página para verla y aceptarla.';

export function ActivationPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [message, setMessage] = useState(() =>
    token
      ? PENDING_MESSAGE
      : 'Falta el enlace de invitación. Pedile a tu administrador que te envíe uno nuevo.',
  );
  const [accepted, setAccepted] = useState(false);
  // Los errores transitorios (429, red) permiten reintentar sin recargar.
  const [retryable, setRetryable] = useState(false);
  const [passwordSetupUrl, setPasswordSetupUrl] = useState<string | null>(null);
  // Canjear registra la aceptación en el servidor, por eso solo ocurre tras marcar la casilla.
  function redeem() {
    if (!token) return;
    setMessage(VALIDATING_MESSAGE);
    setRetryable(false);
    void fetch(`${env.VITE_API_URL}/invitaciones/canjear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, acceptedLegalVersion: LEGAL_VERSION }),
    })
      .then(async (response) => {
        if (response.status === 410 || response.status === 429) {
          const body = failureSchema.parse(await response.json());
          setMessage(failureMessages[body.reason]);
          setRetryable(response.status === 429);
          return;
        }
        // 400: este panel quedó con una versión de los términos anterior a la que exige la API.
        if (response.status === 400) {
          setMessage(OUTDATED_TERMS_MESSAGE);
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
        setMessage('No se pudo validar la invitación. Revisá tu conexión e intentá nuevamente.');
        setRetryable(true);
      });
  }
  const informative =
    passwordSetupUrl !== null || message === PENDING_MESSAGE || message === VALIDATING_MESSAGE;
  return (
    <AuthLayout title="Activar cuenta">
      <div className="space-y-4">
        <Alert
          role="status"
          variant={informative ? 'default' : 'destructive'}
          className={informative ? 'border-info/30 bg-info-soft text-info' : undefined}
        >
          {message}
        </Alert>
        {(message === PENDING_MESSAGE || retryable) && (
          <>
            <LegalConsent checked={accepted} onCheckedChange={setAccepted} />
            <Button size="lg" className="w-full" disabled={!accepted} onClick={redeem}>
              Aceptar y continuar
            </Button>
          </>
        )}
        {passwordSetupUrl && (
          <Button asChild size="lg" className="w-full">
            <a href={passwordSetupUrl}>Definir contraseña</a>
          </Button>
        )}
      </div>
    </AuthLayout>
  );
}

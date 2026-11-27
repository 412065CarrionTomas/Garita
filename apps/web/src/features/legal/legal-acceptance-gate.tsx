import { useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { ApiError } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { useAuth } from '../auth/auth-context';
import { LegalConsent } from './legal-pages';

/**
 * Pide aceptar la versión vigente de Términos y Privacidad antes de usar el panel.
 * Las alertas de pánico quedan siempre accesibles: una emergencia no espera a un trámite.
 * La ayuda también: explica cómo usar Garita y no requiere aceptar nada nuevo.
 */
export function LegalAcceptanceGate({ children }: { children: ReactNode }) {
  const { user, acceptLegal } = useAuth();
  const { pathname } = useLocation();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const path = pathname.replace(/\/+$/, '');
  if (
    !user?.legalAcceptanceRequired ||
    path === '/ayuda' ||
    path === '/alertas-panico' ||
    pathname.startsWith('/alertas-panico/')
  )
    return children;
  return (
    <div className="max-w-xl space-y-6">
      <PageHeader
        title="Actualizamos los Términos y Condiciones"
        description="Para seguir usando Garita necesitamos que leas y aceptes la versión vigente."
      />
      <LegalConsent checked={checked} onCheckedChange={setChecked} />
      {error && (
        <Alert role="alert" variant="destructive">
          {error}
        </Alert>
      )}
      <Button
        disabled={!checked || busy}
        onClick={() => {
          setBusy(true);
          setError('');
          acceptLegal()
            .catch((reason: unknown) => {
              // 400: la API ya exige una versión más nueva que la de este panel.
              setError(
                reason instanceof ApiError && reason.status === 400
                  ? 'Hay una versión más reciente de los términos. Recargá la página para verla y aceptarla.'
                  : 'No pudimos registrar la aceptación. Intentá nuevamente.',
              );
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {busy ? 'Guardando…' : 'Aceptar y continuar'}
      </Button>
    </div>
  );
}

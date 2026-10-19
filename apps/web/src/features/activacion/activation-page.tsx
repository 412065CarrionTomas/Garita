import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { invitationRedeemResponseSchema } from '@garita/shared';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { env } from '@/config/env';

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
    void fetch(`${env.VITE_API_URL}/api/v1/invitaciones/canjear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        if (response.status === 410) {
          const body: unknown = await response.json();
          const text = JSON.stringify(body);
          setMessage(
            text.includes('replaced')
              ? 'Esta invitación fue reemplazada. Pedile a tu administrador que te envíe una nueva'
              : text.includes('used')
                ? 'Esta invitación ya fue usada. Ingresá con tu cuenta.'
                : 'Esta invitación venció. Pedile a tu administrador que te envíe una nueva',
          );
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
    <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full min-w-0 max-w-md space-y-6">
        <div className="flex items-center justify-center gap-2">
          <img src="/logo.svg" alt="" className="size-8" />
          <span className="text-lg font-semibold">Garita</span>
        </div>
        <Card>
          <CardHeader>
            <h1 className="text-2xl font-semibold tracking-tight">Activar cuenta</h1>
          </CardHeader>
          <CardContent className="space-y-4">
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
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

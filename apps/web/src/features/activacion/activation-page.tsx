import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { invitationRedeemResponseSchema } from '@garita/shared';
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
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-3xl font-semibold">Activar cuenta</h1>
      <p role="status" className="mt-4">
        {message}
      </p>
      {passwordSetupUrl && (
        <a className="mt-4 inline-block underline" href={passwordSetupUrl}>
          Definir contraseña
        </a>
      )}
    </main>
  );
}

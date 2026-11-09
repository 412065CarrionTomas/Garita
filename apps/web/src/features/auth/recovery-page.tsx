import { useState } from 'react';
import { Link } from 'react-router';
import { z } from 'zod';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { RESET_MESSAGE, useAuth } from './auth-context';
import { AuthLayout } from './auth-layout';

export function RecoveryPage() {
  const { recover } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = z.email('Ingresá un correo válido').safeParse(email);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Ingresá un correo válido');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await recover(result.data);
      setSent(true);
    } catch (caught) {
      // Solo se oculta "usuario inexistente" para no revelar si el correo existe.
      if ((caught as { code?: string }).code === 'auth/user-not-found') setSent(true);
      else setError('No pudimos enviar el enlace. Revisá tu conexión e intentá de nuevo.');
    }
    setBusy(false);
  }
  return (
    <AuthLayout
      title="Recuperar contraseña"
      description="Te enviaremos un enlace para crear una nueva contraseña."
      footer={
        <Button variant="link" asChild className="w-full">
          <Link to="/ingresar">Volver a ingresar</Link>
        </Button>
      }
    >
      {sent ? (
        <Alert role="status" className="space-y-2 border-info/30 bg-info-soft text-info">
          <p>{RESET_MESSAGE}</p>
          <p className="text-sm text-muted-foreground">Revisá también la carpeta de spam.</p>
        </Alert>
      ) : (
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          noValidate
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="reset-email">Correo electrónico</Label>
            <Input
              id="reset-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'reset-error' : undefined}
            />
          </div>
          {error && (
            <Alert id="reset-error" role="alert" variant="destructive">
              {error}
            </Alert>
          )}
          <Button disabled={busy} size="lg" className="w-full">
            Enviar enlace
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

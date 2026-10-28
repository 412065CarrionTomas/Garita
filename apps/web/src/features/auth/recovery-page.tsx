import { useState } from 'react';
import { Link } from 'react-router';
import { z } from 'zod';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { RESET_MESSAGE, useAuth } from './auth-context';

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
    <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full min-w-0 max-w-md space-y-6">
        <div className="flex items-center justify-center gap-2">
          <img src="/logo.svg" alt="" className="size-8" />
          <span className="text-lg font-semibold">Garita</span>
        </div>
        <Card>
          <CardHeader>
            <h1 className="text-2xl font-semibold tracking-tight">Recuperar contraseña</h1>
            <p className="text-sm text-muted-foreground">
              Te enviaremos un enlace para crear una nueva contraseña.
            </p>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
        <Button variant="link" asChild className="w-full">
          <Link to="/ingresar">Volver a ingresar</Link>
        </Button>
      </div>
    </main>
  );
}

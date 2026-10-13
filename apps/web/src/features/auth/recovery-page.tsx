import { useState } from 'react';
import { Link } from 'react-router';
import { z } from 'zod';

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
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 p-6">
      <header>
        <h1 className="text-3xl font-semibold">Recuperar contraseña</h1>
        <p className="mt-2 text-muted-foreground">
          Te enviaremos un enlace para crear una nueva contraseña.
        </p>
      </header>
      {sent ? (
        <div role="status" className="space-y-2">
          <p>{RESET_MESSAGE}</p>
          <p className="text-sm text-muted-foreground">Revisá también la carpeta de spam.</p>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          noValidate
          className="space-y-4"
        >
          <div className="space-y-2">
            <label htmlFor="reset-email" className="text-sm font-medium">
              Correo electrónico
            </label>
            <input
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
              className="w-full rounded-md border bg-background px-3 py-2"
            />
          </div>
          {error && (
            <p id="reset-error" role="alert">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground"
          >
            Enviar enlace
          </button>
        </form>
      )}
      <Link to="/ingresar" className="text-sm underline underline-offset-4">
        Volver a ingresar
      </Link>
    </main>
  );
}

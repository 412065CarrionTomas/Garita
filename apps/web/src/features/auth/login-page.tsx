import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { z } from 'zod';

import { useAuth } from './auth-context';
import { homePathForRole } from './role-routes';

const loginSchema = z.object({
  email: z.email('Ingresá un correo válido'),
  password: z.string().min(1, 'Ingresá tu contraseña'),
});

export function LoginPage() {
  const { user, loading, login, error: sessionError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  if (loading) return <p role="status">Verificando sesión…</p>;
  if (user) return <Navigate to={homePathForRole(user.role)} replace />;

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Revisá los datos');
      return;
    }
    setFieldError('');
    setBusy(true);
    try {
      const profile = await login(parsed.data.email, parsed.data.password);
      await navigate(homePathForRole(profile.role), { replace: true });
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'No pudimos iniciar sesión');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 p-6">
      <header>
        <p className="text-sm font-semibold text-muted-foreground">GARITA</p>
        <h1 className="text-3xl font-semibold">Iniciar sesión</h1>
        <p className="mt-2 text-muted-foreground">
          Ingresá con el correo y la contraseña de tu cuenta.
        </p>
      </header>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        noValidate
        className="space-y-4"
      >
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            Correo electrónico
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? 'login-error' : undefined}
            className="w-full rounded-md border bg-background px-3 py-2"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            Contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? 'login-error' : undefined}
            className="w-full rounded-md border bg-background px-3 py-2"
          />
        </div>
        {fieldError && (
          <p id="login-error" role="alert" className="text-sm text-destructive">
            {fieldError}
          </p>
        )}
        {(message || sessionError) && (
          <p role="alert" aria-live="assertive" className="text-sm text-destructive">
            {message || sessionError}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60"
        >
          {busy ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
      <Link to="/recuperar" className="text-sm underline underline-offset-4">
        Olvidé mi contraseña
      </Link>
    </main>
  );
}

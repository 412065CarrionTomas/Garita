import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { z } from 'zod';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { LegalLinks } from '../legal/legal-pages';
import { AuthLayout } from './auth-layout';
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
    <AuthLayout
      title="Iniciar sesión"
      description="Ingresá con el correo y la contraseña de tu cuenta."
      footer={
        <>
          <Button variant="link" asChild className="w-full">
            <Link to="/recuperar">Olvidé mi contraseña</Link>
          </Button>
          <LegalLinks />
        </>
      }
    >
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        noValidate
        className="space-y-4"
      >
        <div className="space-y-2">
          <Label htmlFor="email">Correo electrónico</Label>
          <Input
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
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Contraseña</Label>
          <Input
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
          />
        </div>
        {fieldError && (
          <Alert id="login-error" role="alert" variant="destructive">
            {fieldError}
          </Alert>
        )}
        {(message || sessionError) && (
          <Alert role="alert" aria-live="assertive" variant="destructive">
            {message || sessionError}
          </Alert>
        )}
        <Button type="submit" disabled={busy} size="lg" className="w-full">
          {busy ? 'Ingresando…' : 'Ingresar'}
        </Button>
      </form>
    </AuthLayout>
  );
}

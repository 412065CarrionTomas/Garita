import { Navigate, Outlet, Route, Routes, Link } from 'react-router';
import type { ReactNode } from 'react';
import type { UserRole } from '@garita/shared';

import { useAuth } from './auth-context';
import { LoginPage } from './login-page';
import { RecoveryPage } from './recovery-page';
import { homePathForRole } from './role-routes';
import { PersonalPage } from '../personal/personal-page';
import { ActivationPage } from '../activacion/activation-page';
import { ClientDetailPage, ClientsPage } from '../clientes/clients-page';
import { SitesPage } from '../predios/sites-page';
import { ShiftsPanel } from '../turnos/shifts-panel';

function Protected({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <p role="status" className="p-6">
        Verificando sesión…
      </p>
    );
  if (!user) return <Navigate to="/ingresar" replace />;
  if (!roles.includes(user.role)) return <Navigate to={homePathForRole(user.role)} replace />;
  return children;
}

function RoleLayout() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const sections: Record<UserRole, { path: string; title: string }[]> = {
    admin: [
      { path: '/resumen', title: 'Resumen' },
      { path: '/turnos', title: 'Turnos' },
      { path: '/personal', title: 'Personal' },
      { path: '/clientes', title: 'Clientes' },
      { path: '/predios', title: 'Predios' },
    ],
    supervisor: [
      { path: '/turnos', title: 'Turnos' },
      { path: '/personal', title: 'Personal' },
      { path: '/predios', title: 'Predios' },
    ],
    client: [{ path: '/reportes', title: 'Reportes' }],
    guard: [{ path: '/mis-turnos', title: 'Mis turnos' }],
  };
  return (
    <div className="min-h-svh">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <Link to={homePathForRole(user.role)} className="font-semibold">
          Garita
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-sm">
            {user.firstName} · {user.company.name}
          </span>
          <button onClick={() => void logout()} className="rounded-md border px-3 py-2 text-sm">
            Cerrar sesión
          </button>
        </div>
      </header>
      <div className="mx-auto flex max-w-6xl gap-8 p-6">
        <nav aria-label="Navegación principal" className="flex min-w-40 flex-col gap-3">
          {sections[user.role].map((section) => (
            <Link
              key={section.path}
              to={section.path}
              className="text-sm underline underline-offset-4"
            >
              {section.title}
            </Link>
          ))}
        </nav>
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function HomePlaceholder({ title, role }: { title: string; role: string }) {
  return (
    <section>
      <p className="text-sm text-muted-foreground">{role}</p>
      <h1 className="mt-1 text-3xl font-semibold">{title}</h1>
    </section>
  );
}

/** Las rutas de cada sección quedan protegidas por rol dentro del layout autenticado. */
export function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/ingresar" element={<LoginPage />} />
      <Route path="/recuperar" element={<RecoveryPage />} />
      <Route path="/activar" element={<ActivationPage />} />
      <Route
        path="/"
        element={<Navigate to={user ? homePathForRole(user.role) : '/ingresar'} replace />}
      />
      <Route
        element={
          <Protected roles={['admin', 'supervisor', 'client']}>
            <RoleLayout />
          </Protected>
        }
      >
        <Route
          path="/personal"
          element={
            <Protected roles={['admin', 'supervisor']}>
              <PersonalPage />
            </Protected>
          }
        />
        <Route
          path="/resumen"
          element={
            <Protected roles={['admin']}>
              <HomePlaceholder role="Administrador" title="Resumen de la empresa" />
            </Protected>
          }
        />
        <Route
          path="/turnos"
          element={
            <Protected roles={['admin', 'supervisor']}>
              <ShiftsPanel />
            </Protected>
          }
        />
        <Route
          path="/reportes"
          element={
            <Protected roles={['client']}>
              <HomePlaceholder role="Cliente" title="Reportes de mi predio" />
            </Protected>
          }
        />
        <Route
          path="/clientes"
          element={
            <Protected roles={['admin']}>
              <ClientsPage />
            </Protected>
          }
        />
        <Route
          path="/clientes/:id"
          element={
            <Protected roles={['admin']}>
              <ClientDetailPage />
            </Protected>
          }
        />
        <Route
          path="/predios"
          element={
            <Protected roles={['admin', 'supervisor']}>
              <SitesPage />
            </Protected>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

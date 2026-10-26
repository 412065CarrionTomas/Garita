import { Navigate, Outlet, Route, Routes } from 'react-router';
import type { ReactNode } from 'react';
import { USER_ROLE_LABELS } from '@garita/shared';
import type { UserRole } from '@garita/shared';

import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { useAuth } from './auth-context';
import { LoginPage } from './login-page';
import { RecoveryPage } from './recovery-page';
import { homePathForRole } from './role-routes';
import { PersonalPage } from '../personal/personal-page';
import { ActivationPage } from '../activacion/activation-page';
import { ClientDetailPage, ClientsPage } from '../clientes/clients-page';
import { SitesPage } from '../predios/sites-page';
import { ShiftsPanel } from '../turnos/shifts-panel';
import {
  IncidentsListPage,
  IncidentsQueuePage,
  IncidentDetailPage,
  useIncidentPendingCount,
} from '../incidentes/incidents-page';

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

const SECTIONS: Record<UserRole, { path: string; title: string }[]> = {
  admin: [
    { path: '/resumen', title: 'Resumen' },
    { path: '/turnos', title: 'Turnos' },
    { path: '/personal', title: 'Personal' },
    { path: '/clientes', title: 'Clientes' },
    { path: '/predios', title: 'Predios' },
    { path: '/incidentes', title: 'Incidentes' },
  ],
  supervisor: [
    { path: '/turnos', title: 'Turnos' },
    { path: '/personal', title: 'Personal' },
    { path: '/predios', title: 'Predios' },
    { path: '/incidentes', title: 'Incidentes' },
  ],
  client: [{ path: '/reportes', title: 'Reportes' }],
  guard: [{ path: '/mis-turnos', title: 'Mis turnos' }],
};

function RoleLayout() {
  const { user, logout } = useAuth();
  const pending = useIncidentPendingCount(user?.role === 'admin' || user?.role === 'supervisor');
  if (!user) return null;
  return (
    <AppShell
      homePath={homePathForRole(user.role)}
      sections={
        user.role === 'admin' || user.role === 'supervisor'
          ? [
              ...SECTIONS[user.role],
              {
                path: '/incidentes/cola',
                title: `Cola de clasificación (${pending.data?.count ?? 0})`,
              },
            ]
          : SECTIONS[user.role]
      }
      userName={`${user.firstName} ${user.lastName}`}
      roleLabel={USER_ROLE_LABELS[user.role]}
      companyName={user.company.name}
      onLogout={() => void logout()}
    >
      <Outlet />
    </AppShell>
  );
}

function HomePlaceholder({ title, role }: { title: string; role: string }) {
  return <PageHeader title={title} description={role} />;
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
        <Route
          path="/incidentes/cola"
          element={
            <Protected roles={['admin', 'supervisor']}>
              <IncidentsQueuePage />
            </Protected>
          }
        />
        <Route
          path="/incidentes"
          element={
            <Protected roles={['admin', 'supervisor']}>
              <IncidentsListPage />
            </Protected>
          }
        />
        <Route
          path="/incidentes/:id"
          element={
            <Protected roles={['admin', 'supervisor']}>
              <IncidentDetailPage />
            </Protected>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

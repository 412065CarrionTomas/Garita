import { NotificationPreferencesPage } from '../avisos/notification-preferences-page';
import { TrialBanner } from '../cuenta/trial-banner';
import { Navigate, Outlet, Route, Routes } from 'react-router';
import type { ReactNode } from 'react';
import { USER_ROLE_LABELS } from '@garita/shared';
import type { UserRole } from '@garita/shared';

import { AppShell } from '@/components/app-shell';
import type { NavSection } from '@/components/app-shell';
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
import { SupervisionPage } from '../supervision/supervision-page';
import { ShiftDetailPage } from '../supervision/shift-detail-page';
import { ReviewPage, ReviewDetailPage, useReviewCount } from '../revision/review-page';
import { NoticesPage } from '../avisos/notices-page';
import { NoticeDetailPage } from '../avisos/notice-detail-page';
import { useOpenNotices } from '../avisos/queries';
import { useRealtime } from '@/lib/realtime';
import { PanicListPage } from '../panico/panic-list-page';
import { PanicDetailPage } from '../panico/panic-detail-page';
import { PanicBanner } from '../panico/panic-banner';
import { useActivePanicAlerts } from '../panico/queries';
import { ReportsPage } from '../reportes/reports-page';
import { PortalPage } from '../portal/portal-page';
import { IncidentReportsPage } from '../reportes/incidentes/incident-reports-page';
import { SubscriptionPage } from '../suscripcion/subscription-page';

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

interface PendingCounts {
  panic: number;
  notices: number;
  reviews: number;
  incidents: number;
}

/** Barra de administrador y supervisor: lo que se mira, lo pendiente, incidentes y gestión agrupados. */
function staffSections(admin: boolean, counts: PendingCounts): NavSection[] {
  return [
    ...(admin ? [{ path: '/resumen', title: 'Resumen' }] : []),
    { path: '/supervision', title: 'En vivo' },
    {
      title: 'Pendientes',
      children: [
        {
          path: '/alertas-panico',
          title: 'Alertas de pánico',
          count: counts.panic,
          tone: 'danger',
        },
        { path: '/avisos', title: 'Avisos', count: counts.notices },
        { path: '/revision', title: 'Rondas en revisión', count: counts.reviews, tone: 'danger' },
      ],
    },
    { path: '/turnos', title: 'Turnos' },
    {
      // Todo lo de incidentes vive en un solo lugar: el listado, la cola y su reporte.
      title: 'Incidentes',
      children: [
        { path: '/incidentes', title: 'Listado' },
        {
          path: '/incidentes/cola',
          title: 'Por clasificar',
          count: counts.incidents,
          tone: 'warning',
        },
        { path: '/incidentes-y-respuesta', title: 'Reporte de respuesta' },
      ],
    },
    { path: '/cumplimiento', title: 'Cumplimiento' },
    {
      title: 'Gestión',
      children: [
        { path: '/personal', title: 'Personal' },
        ...(admin ? [{ path: '/clientes', title: 'Clientes' }] : []),
        { path: '/predios', title: 'Predios' },
      ],
    },
  ];
}

export function RoleLayout() {
  const { user, logout } = useAuth();
  const pending = useIncidentPendingCount(user?.role === 'admin' || user?.role === 'supervisor');
  const reviews = useReviewCount(user?.role === 'admin' || user?.role === 'supervisor');
  const notices = useOpenNotices(user?.role === 'admin' || user?.role === 'supervisor');
  const realtime = useRealtime(user?.role === 'admin' || user?.role === 'supervisor');
  const panic = useActivePanicAlerts(user?.role === 'admin' || user?.role === 'supervisor');
  if (!user) return null;
  const staff = user.role === 'admin' || user.role === 'supervisor';
  const panicCount = panic.data?.activeCount ?? 0;
  return (
    <AppShell
      homePath={homePathForRole(user.role)}
      sections={
        staff
          ? staffSections(user.role === 'admin', {
              panic: panicCount,
              notices: notices.data?.unseenOpenCount ?? 0,
              reviews: reviews.data?.count ?? 0,
              incidents: pending.data?.count ?? 0,
            })
          : user.role === 'client'
            ? [{ path: '/reportes', title: 'Reportes' }]
            : []
      }
      accountLinks={[
        ...(staff ? [{ path: '/avisos/preferencias', title: 'Preferencias de notificación' }] : []),
        ...(user.role === 'admin' ? [{ path: '/suscripcion', title: 'Suscripción y cobros' }] : []),
      ]}
      alert={staff ? { path: '/alertas-panico', title: 'Pánico', count: panicCount } : undefined}
      notice={staff && !realtime.connected ? 'Reconectando…' : undefined}
      userName={`${user.firstName} ${user.lastName}`}
      roleLabel={USER_ROLE_LABELS[user.role]}
      companyName={user.company.name}
      onLogout={() => void logout()}
    >
      <p aria-live="polite" className="sr-only">
        {realtime.announcement}
      </p>
      {realtime.incident && (
        <div
          role="status"
          className="rounded-md border-[1.5px] border-info bg-info-soft p-3 text-sm text-info"
        >
          <span>{realtime.incident}</span>{' '}
          <button
            type="button"
            className="font-semibold underline"
            onClick={realtime.dismissIncident}
          >
            Cerrar
          </button>
        </div>
      )}
      {(user.role === 'admin' || user.role === 'supervisor') && (
        <PanicBanner alerts={panic.data?.items ?? []} count={panic.data?.activeCount ?? 0} />
      )}
      <TrialBanner />
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
          path="/supervision"
          element={
            <Protected roles={['admin', 'supervisor']}>
              <SupervisionPage />
            </Protected>
          }
        />
        <Route
          path="/alertas-panico"
          element={
            <Protected roles={['admin', 'supervisor']}>
              <PanicListPage />
            </Protected>
          }
        />
        <Route
          path="/alertas-panico/:id"
          element={
            <Protected roles={['admin', 'supervisor']}>
              <PanicDetailPage />
            </Protected>
          }
        />
        <Route
          path="/incidentes-y-respuesta"
          element={
            <Protected roles={['admin', 'supervisor']}>
              <IncidentReportsPage />
            </Protected>
          }
        />
        <Route
          path="/cumplimiento"
          element={
            <Protected roles={['admin', 'supervisor']}>
              <ReportsPage />
            </Protected>
          }
        />
        <Route
          path="/supervision/turnos/:id"
          element={
            <Protected roles={['admin', 'supervisor']}>
              <ShiftDetailPage />
            </Protected>
          }
        />
        <Route
          path="/avisos"
          element={
            <Protected roles={['admin', 'supervisor']}>
              <NoticesPage />
            </Protected>
          }
        />
        <Route
          path="/avisos/preferencias"
          element={
            <Protected roles={['admin', 'supervisor']}>
              <NotificationPreferencesPage />
            </Protected>
          }
        />
        <Route
          path="/avisos/:id"
          element={
            <Protected roles={['admin', 'supervisor']}>
              <NoticeDetailPage />
            </Protected>
          }
        />
        <Route
          path="/revision"
          element={
            <Protected roles={['admin', 'supervisor']}>
              <ReviewPage />
            </Protected>
          }
        />
        <Route
          path="/revision/:id"
          element={
            <Protected roles={['admin', 'supervisor']}>
              <ReviewDetailPage />
            </Protected>
          }
        />
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
              <PortalPage />
            </Protected>
          }
        />
        <Route
          path="/suscripcion"
          element={
            <Protected roles={['admin']}>
              <SubscriptionPage />
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

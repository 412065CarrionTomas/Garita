import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { SUSPENSION_MESSAGES, type UserRole } from '@garita/shared';
import { Alert } from '@/components/ui/alert';

export function AccountSuspendedGate({
  suspended,
  role,
  children,
}: {
  suspended: boolean;
  role: UserRole;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const [denied, setDenied] = useState<string | null>(null);
  const live =
    role !== 'client' &&
    pathname !== '/avisos/preferencias' &&
    (/^\/supervision(?:\/turnos\/[^/]+)?$/.test(pathname) ||
      /^\/(?:avisos|alertas-panico)(?:\/[^/]+)?$/.test(pathname));
  useEffect(() => {
    const reject = (event: Event) => {
      const path: unknown = event instanceof CustomEvent ? event.detail : null;
      if (typeof path !== 'string') return;
      const ownRequest =
        pathname === '/supervision'
          ? path.startsWith('/supervision/turnos')
          : pathname.startsWith('/supervision/turnos/')
            ? path.startsWith(`/turnos/${pathname.split('/').at(-1)}/`)
            : path.split('?')[0] === pathname;
      if (ownRequest) setDenied(pathname);
    };
    window.addEventListener('garita:account-suspended', reject);
    return () => {
      window.removeEventListener('garita:account-suspended', reject);
    };
  }, [pathname]);
  if (
    !suspended ||
    (role === 'admin' && pathname === '/suscripcion') ||
    (live && denied !== pathname)
  )
    return children;
  return (
    <div className="space-y-4">
      <Alert role="status">{SUSPENSION_MESSAGES[role]}</Alert>
      {role === 'admin' && (
        <Link className="font-semibold underline" to="/suscripcion">
          Suscripción y pago
        </Link>
      )}
      {role !== 'client' && (
        <nav aria-label="Turnos en curso" className="flex flex-wrap gap-4">
          <Link className="underline" to="/supervision">
            Turnos en curso
          </Link>
          <Link className="underline" to="/avisos">
            Avisos del turno
          </Link>
          <Link className="underline" to="/alertas-panico">
            Atender pánico
          </Link>
        </nav>
      )}
    </div>
  );
}

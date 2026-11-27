import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { useAuth } from '../auth/auth-context';
import { useAccountState } from './use-account-state';

export function GraceBanner() {
  const { user } = useAuth();
  const account = useAccountState(user?.role === 'admin');
  if (user?.role !== 'admin' || account.data?.status !== 'grace') return null;
  const state = account.data;
  return (
    <Alert role="status" variant="neutral" className="border-warning bg-warning-soft text-warning">
      <p>Cuenta en gracia. El servicio sigue funcionando.</p>
      <p>
        Fecha límite:{' '}
        {state.graceEndsAt
          ? new Date(state.graceEndsAt).toLocaleString('es-AR', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              timeZoneName: 'short',
            })
          : 'Por confirmar'}
        . Monto adeudado: ARS {state.amountDue ?? 'Por confirmar'}.
      </p>
      {state.graceDaysLeft === 3 && <p>Recordatorio: quedan 3 días de gracia.</p>}
      {state.graceDaysLeft === 1 && <p>Hoy termina el período de gracia.</p>}
      <Link to="/suscripcion" className="font-semibold underline">
        Regularizar el cobro
      </Link>
    </Alert>
  );
}

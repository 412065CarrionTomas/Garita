import { Link } from 'react-router';
import { TRIAL_REMINDER_DAYS } from '@garita/shared';
import { Alert } from '@/components/ui/alert';
import { useAuth } from '../auth/auth-context';
import { useAccountState } from './use-account-state';

export function TrialBanner() {
  const { user } = useAuth();
  const account = useAccountState(user?.role === 'admin');
  if (
    user?.role !== 'admin' ||
    account.data?.status !== 'trial' ||
    account.data.trialDaysLeft === null
  )
    return null;
  const remaining = account.data.trialDaysLeft;
  const reminder = TRIAL_REMINDER_DAYS.some((day) => day === remaining);
  return (
    <Alert
      role="status"
      variant="neutral"
      className={reminder ? 'border-warning bg-warning-soft text-warning' : undefined}
    >
      <p>
        {remaining === 1 ? 'Te queda 1 día de prueba' : `Te quedan ${remaining} días de prueba`}.
      </p>
      {reminder && <p>Recordatorio: suscribite para seguir usando Garita al terminar la prueba.</p>}
      <Link to="/suscripcion" className="font-semibold underline">
        Suscribirme
      </Link>
    </Alert>
  );
}

import { StatusBadge } from '@/components/status-badge';

export function SmsBadges({
  channel,
  authenticated,
  phoneMismatch,
}: {
  channel: string;
  authenticated: boolean;
  phoneMismatch?: boolean;
}) {
  return (
    <>
      {channel === 'sms' && <StatusBadge tone="info">Por SMS</StatusBadge>}
      {!authenticated && <StatusBadge tone="danger">No verificada</StatusBadge>}
      {phoneMismatch && <StatusBadge tone="danger">El número no coincide</StatusBadge>}
    </>
  );
}

import type { AccountStatus } from '@garita/shared';
import { Stamp, type StampVariant } from '@/components/stamp';
import { useAccountState } from '@/features/cuenta/use-account-state';
import { WidgetFrame, WidgetStatus } from '../widget-frame';

const STATUS: Record<AccountStatus, { label: string; variant: StampVariant; check?: boolean }> = {
  active: { label: 'Activa', variant: 'normal', check: true },
  trial: { label: 'En prueba', variant: 'dashed' },
  grace: { label: 'Pago pendiente', variant: 'late' },
  suspended: { label: 'Suspendida', variant: 'fail' },
};

const remainingDays = (days: number) => (days === 1 ? 'Queda 1 día' : `Quedan ${days} días`);

export function AccountWidget() {
  const account = useAccountState(true);
  const link = { to: '/suscripcion', label: 'Suscripción' };
  if (!account.data)
    return (
      <WidgetFrame title="Cuenta" link={link}>
        <WidgetStatus query={account} label="el estado de la cuenta" />
      </WidgetFrame>
    );
  const { status, guardLimit, guardsCounted, trialDaysLeft, graceDaysLeft } = account.data;
  const { label, variant, check } = STATUS[status];
  const free = Math.max(0, guardLimit - guardsCounted);
  return (
    <WidgetFrame title="Cuenta" link={link}>
      <dl className="flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
        <div className="flex items-center gap-2">
          <dt className="t-label text-muted-foreground">Estado</dt>
          <dd>
            <Stamp variant={variant} check={check}>
              {label}
            </Stamp>
          </dd>
        </div>
        {status === 'trial' && trialDaysLeft !== null && (
          <div className="flex items-center gap-2">
            <dt className="t-label text-muted-foreground">Prueba</dt>
            <dd className="t-numeral">{remainingDays(trialDaysLeft)}</dd>
          </div>
        )}
        {status === 'grace' && graceDaysLeft !== null && (
          <div className="flex items-center gap-2">
            <dt className="t-label text-muted-foreground">Gracia</dt>
            <dd className="t-numeral">{remainingDays(graceDaysLeft)}</dd>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <dt className="t-label text-muted-foreground">Vigiladores del plan</dt>
          <dd className="flex flex-wrap items-center gap-3">
            <span className="t-numeral">
              {guardsCounted} / {guardLimit}
            </span>
            <span aria-hidden="true" className="block h-2.5 w-32 border-[1.5px] border-foreground">
              <span
                className="block h-full bg-foreground"
                style={{
                  width: `${Math.min(100, (guardsCounted / Math.max(1, guardLimit)) * 100)}%`,
                }}
              />
            </span>
            {free <= 2 && (
              <Stamp variant={free === 0 ? 'fail' : 'late'}>
                {free === 0 ? 'Sin lugares' : free === 1 ? 'Queda 1' : `Quedan ${free}`}
              </Stamp>
            )}
          </dd>
        </div>
      </dl>
    </WidgetFrame>
  );
}

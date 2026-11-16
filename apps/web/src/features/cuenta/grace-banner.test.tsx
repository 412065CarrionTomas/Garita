import { screen } from '@testing-library/react';
import { renderWithQueryClient } from '@/test/render';
import { apiGet } from '@/lib/api-client';
import { useAuth } from '../auth/auth-context';
import { GraceBanner } from './grace-banner';

jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn() }));
jest.mock('../auth/auth-context', () => ({ useAuth: jest.fn() }));
beforeEach(() => jest.clearAllMocks());
function setup(role = 'admin', status = 'grace', remaining = 3) {
  jest.mocked(useAuth).mockReturnValue({ user: { role } } as ReturnType<typeof useAuth>);
  jest.mocked(apiGet).mockResolvedValue({
    status,
    graceEndsAt: '2030-12-09T02:59:00Z',
    graceDaysLeft: remaining,
    amountDue: '45000.00',
  });
  return renderWithQueryClient(<GraceBanner />);
}
it('anuncia estado, fecha límite, monto y recordatorio como texto', async () => {
  setup();
  const banner = await screen.findByRole('status');
  expect(banner).toHaveTextContent('Cuenta en gracia');
  expect(banner).toHaveTextContent('Fecha límite:');
  expect(banner).toHaveTextContent('2030');
  expect(banner).toHaveTextContent('Monto adeudado: ARS 45000.00');
  expect(banner).toHaveTextContent('quedan 3 días');
  expect(screen.getByRole('link', { name: 'Regularizar el cobro' })).toHaveAttribute(
    'href',
    '/suscripcion',
  );
});
it('avisa que hoy termina en el último día', async () => {
  setup('admin', 'grace', 1);
  expect(await screen.findByRole('status')).toHaveTextContent('Hoy termina');
});
it.each(['supervisor', 'client', 'guard'])('no muestra ni consulta deuda para %s', (role) => {
  setup(role);
  expect(apiGet).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('desaparece al aprobarse el cobro y releer la cuenta', async () => {
  setup('admin', 'active');
  await Promise.resolve();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

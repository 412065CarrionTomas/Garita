import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { apiGet } from '@/lib/api-client';
import { useAuth } from '../auth/auth-context';
import { TrialBanner } from './trial-banner';

jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn() }));
jest.mock('../auth/auth-context', () => ({ useAuth: jest.fn() }));

function setup(remaining: number, role = 'admin', status = 'trial') {
  jest.mocked(useAuth).mockReturnValue({ user: { role } } as ReturnType<typeof useAuth>);
  jest.mocked(apiGet).mockResolvedValue({ status, trialDaysLeft: remaining });
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TrialBanner />
    </QueryClientProvider>,
  );
}

beforeEach(() => jest.clearAllMocks());
it.each([14, 7, 3, 1])(
  'muestra %s días accesibles y el acceso para suscribirse',
  async (remaining) => {
    setup(remaining);
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(
      remaining === 1 ? 'Te queda 1 día de prueba' : `Te quedan ${remaining} días de prueba`,
    );
    expect(screen.getByRole('link', { name: 'Suscribirme' })).toHaveAttribute(
      'href',
      '/suscripcion',
    );
    if ([7, 3, 1].includes(remaining)) expect(banner).toHaveTextContent('Recordatorio:');
    else expect(banner).not.toHaveTextContent('Recordatorio:');
  },
);
it.each(['supervisor', 'client'])('no muestra ni consulta estado para %s', (role) => {
  setup(14, role);
  expect(apiGet).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('oculta el banner al terminar la prueba', async () => {
  setup(0, 'admin', 'active');
  await Promise.resolve();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

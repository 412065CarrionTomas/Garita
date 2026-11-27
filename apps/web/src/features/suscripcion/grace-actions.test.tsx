import type * as ApiClient from '@/lib/api-client';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQueryClient } from '@/test/render';
import { apiGet, apiPost } from '@/lib/api-client';
import { useAuth } from '../auth/auth-context';
import { openCheckoutTab, sendToCheckout } from './checkout-redirect';
import { GraceActions } from './grace-actions';

jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual<typeof ApiClient>('@/lib/api-client'),
  apiGet: jest.fn(),
  apiPost: jest.fn(),
}));
jest.mock('../auth/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('./checkout-redirect', () => ({ openCheckoutTab: jest.fn(), sendToCheckout: jest.fn() }));
const close = jest.fn();
const tab = { close } as unknown as Window;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useAuth).mockReturnValue({ user: { role: 'admin' } } as ReturnType<typeof useAuth>);
  jest.mocked(openCheckoutTab).mockReturnValue(tab);
  jest
    .mocked(apiGet)
    .mockImplementation((path: string) =>
      Promise.resolve(
        path === '/cuenta/estado' ? { status: 'grace' } : { url: 'https://mp.test/subscriptions' },
      ),
    );
});
it('ambas acciones funcionan con teclado y explican el pago único y el reintento automático', async () => {
  const user = userEvent.setup();
  jest
    .mocked(apiPost)
    .mockResolvedValue({ initPoint: 'https://mp.test/pay', expiresAt: '2030-12-02T15:00:00Z' });
  renderWithQueryClient(<GraceActions />);
  const method = await screen.findByRole('button', { name: 'Cambiar medio de pago' });
  expect(screen.getByText(/también reintenta/)).toBeInTheDocument();
  await user.tab();
  expect(method).toHaveFocus();
  await user.keyboard('{Enter}');
  await waitFor(() => {
    expect(sendToCheckout).toHaveBeenCalledWith(tab, 'https://mp.test/subscriptions');
  });
  await user.tab();
  expect(screen.getByRole('button', { name: 'Reintentar cobro' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(
    await screen.findByText('Pago único abierto en Mercado Pago. Esperando su aprobación.'),
  ).toBeInTheDocument();
  expect(apiPost).toHaveBeenCalledWith(
    '/suscripcion/reintentar-cobro',
    {},
    expect.anything(),
    expect.anything(),
  );
  expect(sendToCheckout).toHaveBeenCalledWith(tab, 'https://mp.test/pay');
});
it('muestra el conflicto y cierra la pestaña al fallar', async () => {
  jest
    .mocked(apiPost)
    .mockRejectedValue(new Error('El cobro está en proceso en Mercado Pago. Esperá su resultado.'));
  renderWithQueryClient(<GraceActions />);
  await userEvent.click(await screen.findByRole('button', { name: 'Reintentar cobro' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('El cobro está en proceso');
  expect(close).toHaveBeenCalledTimes(1);
});
it('no muestra acciones al supervisor', () => {
  jest
    .mocked(useAuth)
    .mockReturnValue({ user: { role: 'supervisor' } } as ReturnType<typeof useAuth>);
  renderWithQueryClient(<GraceActions />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(apiGet).not.toHaveBeenCalled();
});

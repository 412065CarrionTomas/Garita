import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SubscriptionResponse } from '@garita/shared';
import { renderWithQueryClient } from '@/test/render';
import { ApiError, apiGet, apiPost } from '@/lib/api-client';
import { openCheckoutTab, sendToCheckout } from './checkout-redirect';
import { SubscriptionPage } from './subscription-page';

jest.mock('@/lib/api-client', () => {
  class ApiError extends Error {
    readonly status: number | undefined;
    readonly body: unknown;
    constructor(message: string, status?: number, body?: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }
  return { ApiError, apiGet: jest.fn(), apiPost: jest.fn() };
});
const closeTab = jest.fn();
const tab = { close: closeTab } as unknown as Window;
jest.mock('./checkout-redirect', () => ({ openCheckoutTab: jest.fn(), sendToCheckout: jest.fn() }));
jest.mock('../auth/auth-context', () => ({
  useAuth: () => ({ user: { email: 'admin@garita.test' } }),
}));

const plans = [
  { id: 'plan-10', name: 'Hasta 10 vigiladores', monthlyPrice: '45000.00', maxGuards: 10 },
  { id: 'plan-25', name: 'Hasta 25 vigiladores', monthlyPrice: '95000.00', maxGuards: 25 },
];
const plan = {
  id: 'plan-10',
  name: 'Hasta 10 vigiladores',
  monthlyPrice: '45000.00',
  maxGuards: 10,
};

function mockApi(state: SubscriptionResponse) {
  jest
    .mocked(apiGet)
    .mockImplementation((path: string) => Promise.resolve(path === '/planes' ? plans : state));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(openCheckoutTab).mockReturnValue(tab);
  jest.mocked(sendToCheckout).mockReturnValue(true);
});

describe('SubscriptionPage', () => {
  it('asks for the guard decision after a 409 and submits it with the subscription', async () => {
    mockApi({ trialEndsAt: null, subscription: null });
    jest
      .mocked(apiPost)
      .mockRejectedValueOnce(
        new ApiError('choice', 409, {
          code: 'guard_selection_required',
          maxGuards: 1,
          guards: [
            { id: 'a', name: 'Ana', futureShiftCount: 0 },
            { id: 'b', name: 'Bruno', futureShiftCount: 2 },
          ],
        }),
      )
      .mockResolvedValueOnce({ initPoint: 'https://mp.test/checkout' });
    renderWithQueryClient(<SubscriptionPage />);
    await userEvent.click(await screen.findByRole('radio', { name: /Hasta 10 vigiladores/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Suscribirme' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Ana' }));
    await userEvent.selectOptions(screen.getByRole('combobox'), 'a');
    await userEvent.click(screen.getByRole('button', { name: 'Suscribirme' }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenLastCalledWith(
        '/suscripcion',
        expect.objectContaining({
          guardSelection: {
            guardsToKeep: ['a'],
            shiftDecisions: [{ guardId: 'b', shiftAction: 'derive', deriveToUserId: 'a' }],
          },
        }),
        expect.anything(),
        expect.anything(),
      );
    });
  });
  it('does not submit an empty guard choice and shows the real error of a later attempt', async () => {
    mockApi({ trialEndsAt: null, subscription: null });
    jest
      .mocked(apiPost)
      .mockRejectedValueOnce(
        new ApiError('choice', 409, {
          code: 'guard_selection_required',
          maxGuards: 1,
          guards: [{ id: 'a', name: 'Ana', futureShiftCount: 0 }],
        }),
      )
      .mockRejectedValueOnce(new ApiError('La empresa ya tiene una suscripción activa', 409));
    renderWithQueryClient(<SubscriptionPage />);
    await userEvent.click(await screen.findByRole('radio', { name: /Hasta 10 vigiladores/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Suscribirme' }));
    await screen.findByRole('checkbox', { name: 'Ana' });
    await userEvent.click(screen.getByRole('button', { name: 'Suscribirme' }));
    expect(screen.getByText('Elegí al menos un vigilador que siga activo.')).toBeInTheDocument();
    expect(apiPost).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ana' }));
    await userEvent.click(screen.getByRole('button', { name: 'Suscribirme' }));
    expect(
      await screen.findByText('Tu empresa ya tiene una suscripción activa.'),
    ).toBeInTheDocument();
  });

  it('subscribes to the chosen plan and goes to Mercado Pago', async () => {
    mockApi({ trialEndsAt: null, subscription: null });
    jest.mocked(apiPost).mockResolvedValue({ initPoint: 'https://mp.test/checkout' });
    renderWithQueryClient(<SubscriptionPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Suscribirme' }));
    expect(screen.getByText('Elegí un plan.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: /Hasta 25 vigiladores/ }));
    const email = screen.getByLabelText('Email de tu cuenta de Mercado Pago');
    expect(email).toHaveValue('admin@garita.test');
    await userEvent.clear(email);
    await userEvent.type(email, 'buyer@testuser.com');
    await userEvent.click(screen.getByRole('button', { name: 'Suscribirme' }));

    await waitFor(() => {
      expect(sendToCheckout).toHaveBeenCalledWith(tab, 'https://mp.test/checkout');
    });
    expect(apiPost).toHaveBeenCalledWith(
      '/suscripcion',
      { planId: 'plan-25', payerEmail: 'buyer@testuser.com', keepTrial: false },
      expect.anything(),
      expect.anything(),
    );
    expect(screen.queryByRole('group', { name: 'Prueba gratis' })).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Abrimos Mercado Pago en otra pestaña',
    );
    expect(screen.getByRole('button', { name: 'Suscribirme' })).toBeEnabled();
  });

  it('closes the blank tab when the subscription could not be created', async () => {
    mockApi({ trialEndsAt: null, subscription: null });
    jest.mocked(apiPost).mockRejectedValue(new ApiError('bad gateway', 502));
    renderWithQueryClient(<SubscriptionPage />);

    await userEvent.click(await screen.findByRole('radio', { name: /Hasta 10 vigiladores/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Suscribirme' }));

    expect(await screen.findByText(/Mercado Pago no aceptó la suscripción/)).toBeInTheDocument();
    expect(closeTab).toHaveBeenCalled();
    expect(sendToCheckout).not.toHaveBeenCalled();
  });

  it('lets the admin keep the free trial or pay now', async () => {
    mockApi({ trialEndsAt: '2099-01-10T02:59:59.000Z', subscription: null });
    jest.mocked(apiPost).mockResolvedValue({ initPoint: 'https://mp.test/checkout' });
    renderWithQueryClient(<SubscriptionPage />);

    await userEvent.click(await screen.findByRole('radio', { name: /Hasta 10 vigiladores/ }));
    expect(screen.getByRole('radio', { name: /Seguir con la prueba/ })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: /Pagar ahora/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Suscribirme' }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/suscripcion',
        { planId: 'plan-10', payerEmail: 'admin@garita.test', keepTrial: false },
        expect.anything(),
        expect.anything(),
      );
    });
  });

  it('explains a rejected first payment that Mercado Pago cancelled, and retries with the same payer', async () => {
    mockApi({
      trialEndsAt: null,
      subscription: {
        id: 'sub-1',
        status: 'cancelled',
        plan,
        payerEmail: 'buyer@testuser.com',
        startsAt: '2026-11-15T12:00:00.000Z',
        nextChargeAt: '2026-11-15T12:00:00.000Z',
        lastFailureReason: 'cc_rejected_insufficient_amount',
        cancelAt: null,
        charges: [
          {
            id: 'charge-1',
            amount: '45000.00',
            status: 'rejected',
            statusDetail: 'cc_rejected_insufficient_amount',
            chargedAt: '2026-11-15T12:00:00.000Z',
          },
        ],
      },
    });
    renderWithQueryClient(<SubscriptionPage />);

    expect(await screen.findByText('No se activó')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Mercado Pago rechazó el pago: Fondos insuficientes',
    );
    expect(screen.queryByText('15/11/2026', { selector: 'dd *' })).not.toBeInTheDocument();
    expect(await screen.findByLabelText('Email de tu cuenta de Mercado Pago')).toHaveValue(
      'buyer@testuser.com',
    );
  });

  it('does not call a subscription the admin cancelled a rejection', async () => {
    mockApi({
      trialEndsAt: null,
      subscription: {
        id: 'sub-1',
        status: 'cancelled',
        plan,
        payerEmail: 'buyer@testuser.com',
        startsAt: '2026-11-15T12:00:00.000Z',
        nextChargeAt: null,
        lastFailureReason: null,
        cancelAt: null,
        charges: [
          {
            id: 'charge-1',
            amount: '45000.00',
            status: 'approved',
            statusDetail: 'accredited',
            chargedAt: '2026-11-15T12:00:00.000Z',
          },
        ],
      },
    });
    renderWithQueryClient(<SubscriptionPage />);

    expect(await screen.findByText('Cancelada')).toBeInTheDocument();
    expect(screen.queryByText('No se activó')).not.toBeInTheDocument();
  });

  it('shows an active subscription with its charges and hides the form', async () => {
    mockApi({
      trialEndsAt: null,
      subscription: {
        id: 'sub-1',
        status: 'authorized',
        plan,
        payerEmail: 'buyer@testuser.com',
        startsAt: '2026-11-15T12:00:00.000Z',
        nextChargeAt: '2026-12-15T12:00:00.000Z',
        lastFailureReason: null,
        cancelAt: null,
        charges: [
          {
            id: 'charge-1',
            amount: '45000.00',
            status: 'approved',
            statusDetail: 'accredited',
            chargedAt: '2026-11-15T12:00:00.000Z',
          },
        ],
      },
    });
    renderWithQueryClient(<SubscriptionPage />);

    expect(await screen.findByText('Activa')).toBeInTheDocument();
    expect(screen.getByText('Aprobado')).toBeInTheDocument();
    expect(screen.getByText('Acreditado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suscribirme' })).not.toBeInTheDocument();
  });

  const active = {
    id: 'sub-1',
    status: 'authorized' as const,
    plan,
    payerEmail: 'buyer@testuser.com',
    startsAt: '2026-11-15T12:00:00.000Z',
    nextChargeAt: '2026-12-15T12:00:00.000Z',
    lastFailureReason: null,
    cancelAt: null,
    charges: [],
  };

  it('cancels at the end of the paid cycle after confirming', async () => {
    mockApi({ trialEndsAt: null, subscription: active });
    jest.mocked(apiPost).mockResolvedValue({
      trialEndsAt: null,
      subscription: { ...active, status: 'paused', cancelAt: '2026-12-15T12:00:00.000Z' },
    });
    renderWithQueryClient(<SubscriptionPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar suscripción' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('El servicio sigue funcionando hasta el 15/12/2026');
    await userEvent.type(screen.getByLabelText('Motivo (opcional)'), 'Cerramos la empresa');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar suscripción' }));

    expect(apiPost).toHaveBeenCalledWith(
      '/suscripcion/cancelar',
      { reason: 'Cerramos la empresa' },
      expect.anything(),
      expect.anything(),
    );
    expect(await screen.findByText('Activa hasta el 15/12/2026')).toBeInTheDocument();
    expect(screen.getByText('Sin más cobros')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revertir cancelación' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suscribirme' })).not.toBeInTheDocument();
  });

  it('reverts a scheduled cancellation', async () => {
    mockApi({
      trialEndsAt: null,
      subscription: { ...active, status: 'paused', cancelAt: '2026-12-15T12:00:00.000Z' },
    });
    jest.mocked(apiPost).mockResolvedValue({ trialEndsAt: null, subscription: active });
    renderWithQueryClient(<SubscriptionPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Revertir cancelación' }));

    expect(apiPost).toHaveBeenCalledWith(
      '/suscripcion/revertir-cancelacion',
      {},
      expect.anything(),
      expect.anything(),
    );
    expect(await screen.findByText('Activa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar suscripción' })).toBeInTheDocument();
  });
});

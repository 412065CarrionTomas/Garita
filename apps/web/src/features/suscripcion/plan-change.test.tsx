import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQueryClient } from '@/test/render';
import { apiGet, apiPost } from '@/lib/api-client';
import { PlanChange } from './plan-change';
import { openCheckoutTab, sendToCheckout } from './checkout-redirect';

jest.mock('@/lib/api-client', () => ({
  apiGet: jest.fn(),
  apiPost: jest.fn(),
  ApiError: class extends Error {},
}));
jest.mock('./checkout-redirect', () => ({ openCheckoutTab: jest.fn(), sendToCheckout: jest.fn() }));
const current = {
  id: 's',
  status: 'authorized' as const,
  plan: { id: 'basic', name: 'Inicial', monthlyPrice: '50000.00', maxGuards: 10 },
  payerEmail: 'a@example.invalid',
  startsAt: '2030-11-01T12:00:00Z',
  nextChargeAt: '2030-12-01T12:00:00Z',
  lastFailureReason: null,
  cancelAt: null,
  charges: [],
};
const plans = [
  current.plan,
  { id: 'premium', name: 'Ampliado', monthlyPrice: '90000.00', maxGuards: 25 },
];
const simulation = {
  type: 'upgrade',
  amount: '26666.67',
  effectiveAt: '2030-11-11T12:00:00Z',
  remainingDays: 20,
  cycleDays: 30,
  guardSelectionRequired: null,
};
const history = { pendingPlan: null, pendingEffectiveAt: null, payments: [], changes: [] };
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(apiGet)
    .mockImplementation((path) =>
      Promise.resolve(path === '/planes' ? plans : path.includes('simular') ? simulation : history),
    );
  jest.mocked(apiPost).mockResolvedValue({
    initPoint: 'https://mp.example.invalid/pay',
    effectiveAt: simulation.effectiveAt,
  });
  jest.mocked(openCheckoutTab).mockReturnValue(null);
});

it('muestra diferencia y fecha antes de confirmar, funciona con teclado y abre el checkout existente', async () => {
  renderWithQueryClient(<PlanChange subscription={current} />);
  const select = await screen.findByRole('combobox', { name: 'Nuevo plan' });
  await waitFor(() => {
    expect(screen.getByRole('option', { name: /Ampliado/ })).toBeInTheDocument();
  });
  select.focus();
  await userEvent.selectOptions(select, 'premium');
  expect(
    await screen.findByText(/Diferencia a pagar:.*26.666,67.*Rige desde el/),
  ).toHaveTextContent('11/11/2030');
  expect(apiPost).not.toHaveBeenCalled();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'Confirmar cambio de plan' })).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => {
    expect(sendToCheckout).toHaveBeenCalledWith(null, 'https://mp.example.invalid/pay');
  });
  expect(apiPost).toHaveBeenCalledWith(
    '/suscripcion/cambio-plan',
    { planId: 'premium' },
    expect.anything(),
    expect.anything(),
  );
});

it('muestra estado, motivo rechazado e historial con administrador', async () => {
  jest.mocked(apiGet).mockImplementation((path) =>
    Promise.resolve(
      path === '/planes'
        ? plans
        : {
            ...history,
            payments: [
              {
                id: 'p',
                amount: '26666.67',
                status: 'rejected',
                rejectionReason: 'Fondos insuficientes',
                expiresAt: simulation.effectiveAt,
                amountUpdatePending: false,
              },
            ],
            changes: [
              {
                id: 'c',
                type: 'upgrade',
                planName: 'Ampliado',
                effectiveAt: simulation.effectiveAt,
                createdAt: simulation.effectiveAt,
                adminName: 'Ana Pérez',
                reason: null,
              },
            ],
          },
    ),
  );
  renderWithQueryClient(<PlanChange subscription={current} />);
  expect(await screen.findByText('Motivo: Fondos insuficientes')).toBeVisible();
  expect(screen.getByText(/Rechazada/)).toBeVisible();
  expect(screen.getByRole('cell', { name: 'Ana Pérez' })).toBeVisible();
});

it('baja con selección reutiliza las casillas y envía elección sin abrir checkout', async () => {
  const required = {
    code: 'guard_selection_required',
    maxGuards: 1,
    guards: [
      { id: 'a', name: 'Ana', futureShiftCount: 0 },
      { id: 'b', name: 'Bruno', futureShiftCount: 0 },
    ],
  };
  jest
    .mocked(apiGet)
    .mockImplementation((path) =>
      Promise.resolve(
        path === '/planes'
          ? plans
          : path.includes('simular')
            ? { ...simulation, type: 'downgrade', amount: '0.00', guardSelectionRequired: required }
            : history,
      ),
    );
  jest.mocked(apiPost).mockResolvedValue({ initPoint: null, effectiveAt: current.nextChargeAt });
  renderWithQueryClient(
    <PlanChange
      subscription={{
        ...current,
        plan: { id: 'premium', name: 'Ampliado', monthlyPrice: '90000.00', maxGuards: 25 },
      }}
    />,
  );
  await waitFor(() => {
    expect(screen.getByRole('option', { name: /Inicial/ })).toBeInTheDocument();
  });
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Nuevo plan' }), 'basic');
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Ana' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar cambio de plan' }));
  await waitFor(() => {
    expect(apiPost).toHaveBeenCalled();
  });
  expect(apiPost).toHaveBeenCalledWith(
    '/suscripcion/cambio-plan',
    {
      planId: 'basic',
      guardSelection: {
        guardsToKeep: ['a'],
        shiftDecisions: [{ guardId: 'b', shiftAction: 'unassign', confirmUnassignedCount: 0 }],
      },
    },
    expect.anything(),
    expect.anything(),
  );
  expect(openCheckoutTab).not.toHaveBeenCalled();
});

it('pago pendiente bloquea otro cambio y muestra vencimiento', async () => {
  jest.mocked(apiGet).mockImplementation((path) =>
    Promise.resolve(
      path === '/planes'
        ? plans
        : {
            ...history,
            payments: [
              {
                id: 'p',
                amount: '1.00',
                status: 'pending',
                rejectionReason: null,
                expiresAt: simulation.effectiveAt,
                amountUpdatePending: false,
              },
            ],
          },
    ),
  );
  renderWithQueryClient(<PlanChange subscription={current} />);
  expect(await screen.findByText(/El enlace vence/)).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Nuevo plan' })).toBeDisabled();
});

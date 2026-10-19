import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQueryClient } from '@/test/render';
import { apiPut } from '@/lib/api-client';
import { SiteConnectivityForm } from './site-connectivity-form';

jest.mock('@/lib/api-client', () => ({ apiPut: jest.fn(), ApiError: class extends Error {} }));
const initial = { type: 'with_signal' as const, minutesToSignal: 0, marginMinutes: 30 };

describe('Conectividad', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it('BDD1: previews 09:40 and 18:20 live and saves through the API', async () => {
    jest
      .mocked(apiPut)
      .mockResolvedValue({ type: 'without_signal', minutesToSignal: 180, marginMinutes: 20 });
    const user = userEvent.setup();
    const onSaved = jest.fn();
    renderWithQueryClient(
      <SiteConnectivityForm siteId="site" initial={initial} onSaved={onSaved} />,
    );
    await user.selectOptions(screen.getByLabelText('Tipo de conectividad'), 'without_signal');
    await user.clear(screen.getByLabelText('Horas'));
    await user.type(screen.getByLabelText('Horas'), '3');
    await user.clear(screen.getByLabelText('Margen adicional (minutos)'));
    await user.type(screen.getByLabelText('Margen adicional (minutos)'), '20');
    expect(screen.getByText(/Un turno de 13 a 15/)).toHaveTextContent(
      /desde las 0?9:40.*antes de las 18:20/,
    );
    await user.click(screen.getByRole('button', { name: 'Guardar conectividad' }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(apiPut).toHaveBeenCalledWith(
      '/predios/site/conectividad',
      { type: 'without_signal', minutesToSignal: 180, marginMinutes: 20 },
      expect.anything(),
      expect.anything(),
    );
  });
  it('associates validation errors with fields and does not send zero travel', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(
      <SiteConnectivityForm siteId="site" initial={initial} onSaved={jest.fn()} />,
    );
    await user.selectOptions(screen.getByLabelText('Tipo de conectividad'), 'without_signal');
    await user.click(screen.getByRole('button', { name: 'Guardar conectividad' }));
    expect(screen.getByLabelText('Horas')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Minutos')).toHaveAccessibleDescription(/mayor que 0/);
    expect(apiPut).not.toHaveBeenCalled();
  });
  it('shows save errors and allows retry', async () => {
    jest.mocked(apiPut).mockRejectedValue(new Error('Sin conexión'));
    const user = userEvent.setup();
    renderWithQueryClient(
      <SiteConnectivityForm siteId="site" initial={initial} onSaved={jest.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Guardar conectividad' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión');
    expect(screen.getByRole('button', { name: 'Guardar conectividad' })).toBeEnabled();
  });

  it('ignores hidden travel fields when switching back to signal', async () => {
    jest.mocked(apiPut).mockResolvedValue(initial);
    const user = userEvent.setup();
    renderWithQueryClient(
      <SiteConnectivityForm
        siteId="site"
        initial={{ ...initial, type: 'without_signal', minutesToSignal: 180 }}
        onSaved={jest.fn()}
      />,
    );
    await user.clear(screen.getByLabelText('Horas'));
    await user.type(screen.getByLabelText('Horas'), '-1');
    await user.selectOptions(screen.getByLabelText('Tipo de conectividad'), 'with_signal');
    await user.click(screen.getByRole('button', { name: 'Guardar conectividad' }));
    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith(
        '/predios/site/conectividad',
        initial,
        expect.anything(),
        expect.anything(),
      );
    });
  });

  it('is operable by keyboard and identifies deadlines on the following day', async () => {
    jest
      .mocked(apiPut)
      .mockResolvedValue({ type: 'without_signal', minutesToSignal: 720, marginMinutes: 180 });
    const user = userEvent.setup();
    renderWithQueryClient(
      <SiteConnectivityForm
        siteId="site"
        initial={{ type: 'without_signal', minutesToSignal: 720, marginMinutes: 180 }}
        onSaved={jest.fn()}
      />,
    );
    expect(screen.getByText(/Un turno de 13 a 15/)).toHaveTextContent('06:00 del día siguiente');
    for (const label of [
      'Tipo de conectividad',
      'Horas',
      'Minutos',
      'Margen adicional (minutos)',
    ]) {
      await user.tab();
      expect(screen.getByLabelText(label)).toHaveFocus();
    }
    await user.tab();
    expect(screen.getByRole('button', { name: 'Guardar conectividad' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledTimes(1);
    });
  });
});

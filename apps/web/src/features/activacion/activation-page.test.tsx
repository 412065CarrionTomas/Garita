import { render, screen } from '@testing-library/react';
import { ActivationPage } from './activation-page';

function mockResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('ActivationPage', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/activar?token=valid-token');
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('permite al vigilador definir su contraseña antes de ingresar desde la app', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        mockResponse(200, { role: 'guard', passwordSetupUrl: 'https://firebase.example/reset' }),
      );
    render(<ActivationPage />);
    expect(
      await screen.findByText(
        'Una vez definida tu contraseña, ingresá desde la app móvil de Garita.',
      ),
    ).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Definir contraseña' })).toHaveAttribute(
      'href',
      'https://firebase.example/reset',
    );
  });

  it('muestra el mensaje de invitación vencida ante 410', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(410, { message: 'expired' }));
    render(<ActivationPage />);
    expect(await screen.findByText(/Esta invitación venció/i)).toBeInTheDocument();
  });

  it('ofrece al supervisor el enlace para definir la contraseña', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, {
        role: 'supervisor',
        passwordSetupUrl: 'https://firebase.example/reset',
      }),
    );
    render(<ActivationPage />);
    expect(
      await screen.findByText('Invitación válida. Definí tu contraseña para ingresar.'),
    ).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Definir contraseña' })).toHaveAttribute(
      'href',
      'https://firebase.example/reset',
    );
  });
});

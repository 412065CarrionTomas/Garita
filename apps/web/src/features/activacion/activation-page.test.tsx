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

  it('informa al vigilador que debe entrar desde la app', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        mockResponse(200, { role: 'guard', passwordSetupUrl: 'https://firebase.example/reset' }),
      );
    render(<ActivationPage />);
    expect(await screen.findByText(/ingresá desde la app móvil/i)).toBeInTheDocument();
  });

  it('muestra el mensaje de invitación vencida ante 410', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(410, { message: 'expired' }));
    render(<ActivationPage />);
    expect(await screen.findByText(/Esta invitación venció/i)).toBeInTheDocument();
  });

  it('confirma que la invitación del supervisor es válida', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, {
        role: 'supervisor',
        passwordSetupUrl: 'https://firebase.example/reset',
      }),
    );
    render(<ActivationPage />);
    expect(await screen.findByText(/llevando a definir tu contraseña/i)).toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { LEGAL_VERSION } from '@garita/shared';
import { ActivationPage } from './activation-page';

function mockResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  } as Response;
}

function acceptTerms() {
  fireEvent.click(screen.getByRole('checkbox', { name: /Leí y acepto/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Aceptar y continuar' }));
}

describe('ActivationPage', () => {
  it('no canjea la invitación hasta aceptar los términos y envía la versión aceptada', () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise<Response>(() => {
        // Sin respuesta: solo interesa el pedido.
      }),
    );
    render(<ActivationPage />);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Aceptar y continuar' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Términos y Condiciones' })).toHaveAttribute(
      'href',
      '/terminos',
    );
    acceptTerms();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(JSON.parse(init?.body as string)).toEqual({
      token: 'valid-token',
      acceptedLegalVersion: LEGAL_VERSION,
    });
  });

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
    acceptTerms();
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
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(410, { reason: 'expired' }));
    render(<ActivationPage />);
    acceptTerms();
    expect(await screen.findByText(/Esta invitación venció/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveClass('text-danger');
  });

  it.each([
    [
      410,
      'invalid',
      'Esta invitación no es válida. Pedile a tu administrador que te envíe una nueva',
    ],
    [
      410,
      'replaced',
      'Esta invitación fue reemplazada. Pedile a tu administrador que te envíe una nueva',
    ],
    [410, 'used', 'Esta invitación ya fue usada. Ingresá con tu cuenta.'],
    [429, 'rate_limited', 'Demasiados intentos. Esperá un minuto y volvé a intentarlo.'],
  ])('explica el motivo %s %s', async (status, reason, message) => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(mockResponse(status, { reason, message: 'used expired' }));
    render(<ActivationPage />);
    acceptTerms();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Definir contraseña' })).not.toBeInTheDocument();
  });

  it('ofrece al supervisor el enlace para definir la contraseña', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockResponse(200, {
        role: 'supervisor',
        passwordSetupUrl: 'https://firebase.example/reset',
      }),
    );
    render(<ActivationPage />);
    acceptTerms();
    expect(
      await screen.findByText('Invitación válida. Definí tu contraseña para ingresar.'),
    ).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Definir contraseña' })).toHaveAttribute(
      'href',
      'https://firebase.example/reset',
    );
  });
});

it('mantiene el estado informativo mientras valida', () => {
  jest.spyOn(globalThis, 'fetch').mockReturnValue(
    new Promise<Response>(() => {
      // Mantiene pendiente la validación para observar el estado inicial.
    }),
  );
  window.history.replaceState({}, '', '/activar?token=valid-token');
  render(<ActivationPage />);
  acceptTerms();
  expect(screen.getByRole('status')).toHaveTextContent('Validando invitación…');
  expect(screen.getByRole('status')).toHaveClass('text-info');
  jest.restoreAllMocks();
});

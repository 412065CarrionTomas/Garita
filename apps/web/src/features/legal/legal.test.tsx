import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { privacyPolicy, termsOfService } from '@garita/shared';
import type { AuthMeResponse } from '@garita/shared';

import { ApiError } from '@/lib/api-client';
import { useAuth } from '../auth/auth-context';
import { LegalAcceptanceGate } from './legal-acceptance-gate';
import { PrivacyPage, TermsPage } from './legal-pages';

jest.mock('../auth/auth-context', () => ({ useAuth: jest.fn() }));
const useAuthMock = jest.mocked(useAuth);

const profile: AuthMeResponse = {
  id: 'u1',
  firstName: 'Ana',
  lastName: 'García',
  email: 'ana@example.com',
  role: 'admin',
  status: 'active',
  company: { id: 'c1', name: 'Seguridad Norte' },
  allowedChannels: ['web', 'mobile'],
};

function renderGate(legalAcceptanceRequired: boolean, acceptLegal = jest.fn()) {
  useAuthMock.mockReturnValue({
    user: { ...profile, legalAcceptanceRequired },
    loading: false,
    login: jest.fn(),
    logout: jest.fn(),
    recover: jest.fn(),
    acceptLegal,
    error: '',
    clearError: jest.fn(),
  });
  return render(
    <LegalAcceptanceGate>
      <p>Contenido del panel</p>
    </LegalAcceptanceGate>,
  );
}

describe('LegalAcceptanceGate', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('muestra el panel cuando la versión vigente ya fue aceptada', () => {
    renderGate(false);
    expect(screen.getByText('Contenido del panel')).toBeInTheDocument();
  });

  it('pide aceptar antes de mostrar el panel y solo acepta con la casilla marcada', async () => {
    const acceptLegal = jest.fn().mockResolvedValue(undefined);
    renderGate(true, acceptLegal);
    expect(screen.queryByText('Contenido del panel')).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Aceptar y continuar' });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Leí y acepto/ }));
    fireEvent.click(button);
    await waitFor(() => {
      expect(acceptLegal).toHaveBeenCalledTimes(1);
    });
  });

  it('informa el error si no se pudo registrar la aceptación', async () => {
    renderGate(true, jest.fn().mockRejectedValue(new Error('red')));
    fireEvent.click(screen.getByRole('checkbox', { name: /Leí y acepto/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar y continuar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos registrar');
  });

  it('pide recargar si la API ya exige una versión más nueva', async () => {
    renderGate(true, jest.fn().mockRejectedValue(new ApiError('viejo', 400)));
    fireEvent.click(screen.getByRole('checkbox', { name: /Leí y acepto/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar y continuar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Recargá la página');
  });

  it('no deja pasar rutas que solo comparten el prefijo de pánico', () => {
    window.history.replaceState({}, '', '/alertas-panico-historial');
    renderGate(true);
    expect(screen.queryByText('Contenido del panel')).not.toBeInTheDocument();
  });

  it('nunca bloquea la atención de alertas de pánico', () => {
    window.history.replaceState({}, '', '/alertas-panico/a1');
    renderGate(true);
    expect(screen.getByText('Contenido del panel')).toBeInTheDocument();
  });
});

describe('páginas legales', () => {
  it('muestran todas las secciones y enlazan entre sí', () => {
    const { unmount } = render(<TermsPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(termsOfService.title);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(
      termsOfService.sections.length,
    );
    expect(screen.getByText(/NO REEMPLAZA A LOS SERVICIOS DE EMERGENCIA/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: privacyPolicy.title })).toHaveAttribute(
      'href',
      '/privacidad',
    );
    unmount();
    render(<PrivacyPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(privacyPolicy.title);
    expect(screen.getByText(/AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA/)).toBeInTheDocument();
  });
});

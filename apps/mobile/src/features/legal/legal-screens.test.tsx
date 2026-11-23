import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { router } from 'expo-router';
import { termsOfService } from '@garita/shared';
import type { AuthMeResponse } from '@garita/shared';
import Index from '@/app/index';
import { useAuth } from '../auth/auth-context';
import { getRunningPanicShift } from '../panico/running-shift';
import { AcceptLegalScreen, LegalDocumentScreen } from './legal-screens';

jest.mock('expo-router', () => {
  const actual = jest.requireActual<Record<string, unknown>>('@/test/expo-router');
  return {
    ...actual,
    Redirect: ({ href }: { href: string }) => {
      const { Text } = jest.requireActual<{ Text: (props: { children: ReactNode }) => ReactNode }>(
        'react-native',
      );
      return <Text>{`redirect:${href}`}</Text>;
    },
  };
});
jest.mock('../auth/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('../panico/running-shift', () => ({ getRunningPanicShift: jest.fn() }));
jest.mock('@/lib/db/database', () => ({ createDefaultFieldRepository: jest.fn(async () => ({})) }));

const useAuthMock = jest.mocked(useAuth);
const runningShiftMock = jest.mocked(getRunningPanicShift);

const guard: AuthMeResponse = {
  id: 'u1',
  firstName: 'Juan',
  lastName: 'Pérez',
  email: 'juan@example.com',
  role: 'guard',
  status: 'active',
  company: { id: 'c1', name: 'Seguridad Norte' },
  allowedChannels: ['mobile'],
};

function mockAuth(user: AuthMeResponse | null, acceptLegal = jest.fn()) {
  useAuthMock.mockReturnValue({
    user,
    loading: false,
    login: jest.fn(),
    logout: jest.fn(),
    recover: jest.fn(),
    acceptLegal,
    error: '',
  });
}

describe('inicio con aceptación pendiente', () => {
  beforeEach(() => {
    runningShiftMock.mockReset();
  });

  it('va al área del rol cuando la versión vigente ya fue aceptada', async () => {
    mockAuth({ ...guard, legalAcceptanceRequired: false });
    const view = await render(<Index />);
    expect(view.getByText('redirect:/(guard)')).toBeTruthy();
  });

  it('pide aceptar los términos si no hay un turno en curso', async () => {
    runningShiftMock.mockResolvedValue(null);
    mockAuth({ ...guard, legalAcceptanceRequired: true });
    const view = await render(<Index />);
    expect(await view.findByText('redirect:/aceptar-terminos')).toBeTruthy();
  });

  it('nunca interpone la aceptación sobre un turno en curso', async () => {
    runningShiftMock.mockResolvedValue({} as Awaited<ReturnType<typeof getRunningPanicShift>>);
    mockAuth({ ...guard, legalAcceptanceRequired: true });
    const view = await render(<Index />);
    expect(await view.findByText('redirect:/(guard)')).toBeTruthy();
  });
});

describe('AcceptLegalScreen', () => {
  it('registra la aceptación y continúa al área del rol', async () => {
    const acceptLegal = jest.fn().mockResolvedValue(undefined);
    mockAuth({ ...guard, legalAcceptanceRequired: true }, acceptLegal);
    const view = await render(<AcceptLegalScreen />);
    fireEvent.press(
      view.getByLabelText('Leí y acepto los Términos y Condiciones y la Política de Privacidad'),
    );
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/(guard)');
    });
    expect(acceptLegal).toHaveBeenCalledTimes(1);
  });

  it('informa el error sin continuar', async () => {
    jest.mocked(router.replace).mockClear();
    mockAuth({ ...guard, legalAcceptanceRequired: true }, jest.fn().mockRejectedValue(new Error()));
    const view = await render(<AcceptLegalScreen />);
    fireEvent.press(
      view.getByLabelText('Leí y acepto los Términos y Condiciones y la Política de Privacidad'),
    );
    expect(await view.findByText(/No pudimos registrar la aceptación/)).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

it('muestra el documento completo sin conexión', async () => {
  const view = await render(<LegalDocumentScreen slug="terminos" />);
  expect(view.getByText(termsOfService.title)).toBeTruthy();
  for (const section of termsOfService.sections)
    expect(view.getByText(section.heading)).toBeTruthy();
});

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { termsOfService } from '@garita/shared';
import type { AuthMeResponse } from '@garita/shared';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '../auth/auth-context';
import { getRunningPanicShift } from '../panico/running-shift';
import { AcceptLegalScreen, LegalDocumentScreen, useLegalGate } from './legal-screens';

jest.mock('expo-router', () => {
  const actual = jest.requireActual<Record<string, unknown>>('@/test/expo-router');
  return {
    ...actual,
    router: { replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
    Redirect: ({ href }: { href: string }) => {
      const { Text: NativeText } = jest.requireActual<{
        Text: (props: { children: ReactNode }) => ReactNode;
      }>('react-native');
      return <NativeText>{`redirect:${href}`}</NativeText>;
    },
  };
});
jest.mock('../auth/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('../panico/running-shift', () => ({ getRunningPanicShift: jest.fn() }));
jest.mock('@/lib/db/database', () => ({ createDefaultFieldRepository: jest.fn(async () => ({})) }));

const useAuthMock = jest.mocked(useAuth);
const runningShiftMock = jest.mocked(getRunningPanicShift);
const mockedRouter = router as unknown as {
  replace: jest.Mock;
  back: jest.Mock;
  canGoBack: jest.Mock;
};
const runningShift = {} as Awaited<ReturnType<typeof getRunningPanicShift>>;

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

function GateProbe({ user }: { user: AuthMeResponse }) {
  return <Text>{`gate:${useLegalGate(user)}`}</Text>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedRouter.canGoBack.mockReturnValue(true);
});

describe('useLegalGate', () => {
  it('deja pasar cuando la versión vigente ya fue aceptada', async () => {
    const view = await render(<GateProbe user={{ ...guard, legalAcceptanceRequired: false }} />);
    expect(view.getByText('gate:allow')).toBeTruthy();
    expect(runningShiftMock).not.toHaveBeenCalled();
  });

  it('exige aceptar al vigilador sin turno en curso', async () => {
    runningShiftMock.mockResolvedValue(null);
    const view = await render(<GateProbe user={{ ...guard, legalAcceptanceRequired: true }} />);
    expect(await view.findByText('gate:require')).toBeTruthy();
  });

  it('nunca interpone la aceptación sobre un turno en curso', async () => {
    runningShiftMock.mockResolvedValue(runningShift);
    const view = await render(<GateProbe user={{ ...guard, legalAcceptanceRequired: true }} />);
    expect(await view.findByText('gate:allow')).toBeTruthy();
  });

  it('a otros roles les exige aceptar aunque en el celular quede un turno local', async () => {
    runningShiftMock.mockResolvedValue(runningShift);
    const view = await render(
      <GateProbe user={{ ...guard, role: 'supervisor', legalAcceptanceRequired: true }} />,
    );
    expect(view.getByText('gate:require')).toBeTruthy();
    expect(runningShiftMock).not.toHaveBeenCalled();
  });

  it('vuelve a consultar el turno cuando cambia el usuario', async () => {
    runningShiftMock.mockResolvedValueOnce(runningShift);
    const view = await render(<GateProbe user={{ ...guard, legalAcceptanceRequired: true }} />);
    expect(await view.findByText('gate:allow')).toBeTruthy();
    runningShiftMock.mockResolvedValueOnce(null);
    await view.rerender(<GateProbe user={{ ...guard, id: 'u2', legalAcceptanceRequired: true }} />);
    expect(await view.findByText('gate:require')).toBeTruthy();
  });
});

describe('AcceptLegalScreen', () => {
  const acceptButton = 'Leí y acepto los Términos y Condiciones y la Política de Privacidad';

  it('registra la aceptación y continúa al área del rol', async () => {
    const acceptLegal = jest.fn().mockResolvedValue(undefined);
    mockAuth({ ...guard, legalAcceptanceRequired: true }, acceptLegal);
    const view = await render(<AcceptLegalScreen />);
    fireEvent.press(view.getByLabelText(acceptButton));
    await waitFor(() => {
      expect(mockedRouter.replace).toHaveBeenCalledWith('/(guard)');
    });
    expect(acceptLegal).toHaveBeenCalledTimes(1);
  });

  it('informa el error de conexión sin continuar', async () => {
    mockAuth({ ...guard, legalAcceptanceRequired: true }, jest.fn().mockRejectedValue(new Error()));
    const view = await render(<AcceptLegalScreen />);
    fireEvent.press(view.getByLabelText(acceptButton));
    expect(await view.findByText(/Revisá tu conexión/)).toBeTruthy();
    expect(mockedRouter.replace).not.toHaveBeenCalled();
  });

  it('pide actualizar la app si la API exige una versión más nueva', async () => {
    mockAuth(
      { ...guard, legalAcceptanceRequired: true },
      jest.fn().mockRejectedValue(new ApiError('viejo', 400)),
    );
    const view = await render(<AcceptLegalScreen />);
    fireEvent.press(view.getByLabelText(acceptButton));
    expect(await view.findByText(/Actualizá la app de Garita/)).toBeTruthy();
  });

  it('redirige al área del rol si ya aceptó', async () => {
    mockAuth({ ...guard, legalAcceptanceRequired: false });
    const view = await render(<AcceptLegalScreen />);
    expect(view.getByText('redirect:/(guard)')).toBeTruthy();
  });
});

describe('LegalDocumentScreen', () => {
  it('muestra el documento completo sin conexión', async () => {
    const view = await render(<LegalDocumentScreen slug="terminos" />);
    expect(view.getByText(termsOfService.title)).toBeTruthy();
    for (const section of termsOfService.sections)
      expect(view.getByText(section.heading)).toBeTruthy();
  });

  it('ante un slug desconocido muestra los términos en vez de fallar', async () => {
    const view = await render(<LegalDocumentScreen slug="constructor" />);
    expect(view.getByText(termsOfService.title)).toBeTruthy();
  });

  it('permite volver a la pantalla anterior o al inicio', async () => {
    const view = await render(<LegalDocumentScreen slug="privacidad" />);
    fireEvent.press(view.getByText('Volver'));
    expect(mockedRouter.back).toHaveBeenCalledTimes(1);
    mockedRouter.canGoBack.mockReturnValue(false);
    fireEvent.press(view.getByText('Volver'));
    expect(mockedRouter.replace).toHaveBeenCalledWith('/');
  });
});

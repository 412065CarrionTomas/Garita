import type React from 'react';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import type { AuthMeResponse } from '@garita/shared';
import { ThemeProvider } from '@/ui';
import { useAuth } from '@/features/auth/auth-context';
import { apiGet } from '@/lib/api-client';
import { nfcAvailability, openNfcSettings } from '@/lib/nfc';
import ConfigurationHome from '@/app/(configuration)/index';

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<{ useEffect: typeof React.useEffect }>('react');
  return {
    router: { push: (...args: unknown[]) => mockPush(...args) },
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('@/features/auth/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/api-client', () => ({ apiGet: jest.fn() }));
jest.mock('@/lib/nfc', () => ({ nfcAvailability: jest.fn(), openNfcSettings: jest.fn() }));
jest.mock('@/lib/cola', () => ({ getSyncSnapshot: jest.fn() }));

const logout = jest.fn();
const sites = [
  { id: 'done', name: 'Alfa completo', total: 3, tagged: 3 },
  { id: 'pending', name: 'Zeta pendiente', total: 5, tagged: 2 },
  { id: 'empty', name: 'Beta vacío', total: 0, tagged: 0 },
];

beforeEach(() => {
  jest.clearAllMocks();
  const user = {
    role: 'admin',
    firstName: 'Ana',
    lastName: 'García',
    company: { name: 'Seguridad Norte' },
  } as AuthMeResponse;
  jest.mocked(useAuth).mockReturnValue({ user, logout } as unknown as ReturnType<typeof useAuth>);
  jest.mocked(apiGet).mockResolvedValue(sites as never);
  jest.mocked(nfcAvailability).mockResolvedValue('ready');
});

const mount = () =>
  render(
    <ThemeProvider>
      <ConfigurationHome />
    </ThemeProvider>,
  );

it('pone primero los predios con puntos sin etiqueta y dice cuántos faltan', async () => {
  await mount();
  const rows = await screen.findAllByLabelText(/^(Alfa|Zeta|Beta)/);
  expect(rows.map((row) => row.props.accessibilityLabel)).toEqual([
    'Zeta pendiente. Faltan 3 de 5 puntos',
    'Alfa completo. Completo: 3 puntos con etiqueta',
    'Beta vacío. Sin puntos cargados',
  ]);
});

it('abre el predio con su nombre', async () => {
  const user = userEvent.setup();
  await mount();
  await user.press(await screen.findByLabelText(/^Zeta pendiente/));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/(configuration)/predio/[id]',
    params: { id: 'pending', nombre: 'Zeta pendiente' },
  });
});

it('con NFC apagado avisa, ofrece activarlo y no deja identificar', async () => {
  jest.mocked(nfcAvailability).mockResolvedValue('disabled');
  const user = userEvent.setup();
  await mount();
  await user.press(await screen.findByLabelText('Abrir ajustes de NFC'));
  expect(openNfcSettings).toHaveBeenCalled();
  expect(screen.getByLabelText('Identificar etiqueta: ver de qué punto es')).toBeDisabled();
});

it('avisa si no pudo cargar los predios', async () => {
  jest.mocked(apiGet).mockRejectedValue(new Error('offline'));
  await mount();
  expect(await screen.findByText(/No se pudieron cargar los predios/)).toBeOnTheScreen();
});

it('el menú deja cambiar el tema y cerrar sesión sin pasar por envíos', async () => {
  const user = userEvent.setup();
  await mount();
  await user.press(await screen.findByRole('button', { name: 'Abrir menú' }));
  expect(screen.getByText('Administrador · Seguridad Norte')).toBeOnTheScreen();
  expect(screen.queryByText('Envíos')).toBeNull();
  await user.press(await screen.findByRole('radio', { name: 'Oscuro' }));
  expect(screen.getByRole('radio', { name: 'Oscuro' })).toBeChecked();
  await user.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
  await waitFor(() => expect(logout).toHaveBeenCalled());
});

it('filtra los predios por nombre sin importar mayúsculas ni tildes', async () => {
  jest
    .mocked(apiGet)
    .mockResolvedValue([
      ...sites,
      { id: 'al', name: 'Campo Los Álamos', total: 1, tagged: 0 },
    ] as never);
  const user = userEvent.setup();
  await mount();
  await user.type(await screen.findByLabelText('Buscar predio'), 'alamos');
  expect(screen.getByLabelText(/^Campo Los Álamos/)).toBeOnTheScreen();
  expect(screen.queryByLabelText(/^Zeta pendiente/)).toBeNull();
  await user.clear(screen.getByLabelText('Buscar predio'));
  await user.type(screen.getByLabelText('Buscar predio'), 'xyz');
  expect(screen.getByText('Ningún predio coincide con "xyz".')).toBeOnTheScreen();
});

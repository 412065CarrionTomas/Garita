import { render, screen, userEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import type { GuardSite } from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { SitesScreen } from './sites-screen';

jest.mock('@/lib/api-client', () => {
  const actual = jest.requireActual('@/lib/api-client');
  return { ...actual, apiGet: jest.fn() };
});

const site: GuardSite = {
  id: 'p1',
  name: 'Parque Ferreyra',
  address: 'Ruta 9 km 4',
  latitude: -31.4,
  longitude: -64.1,
  accessInstructions: 'Portón norte, pedir llave en garita',
  supervisors: ['Ana Paz'],
  rounds: [{ name: 'Perimetral', checkpoints: 8 }],
  nextShiftAt: null,
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

it('despliega cómo llegar, el acceso, las rondas y quién supervisa', async () => {
  jest.mocked(apiGet).mockResolvedValue([site]);
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await render(<SitesScreen />);
  const user = userEvent.setup();
  await user.press(await screen.findByText('Parque Ferreyra'));
  expect(screen.getByText('Portón norte, pedir llave en garita')).toBeOnTheScreen();
  expect(screen.getByText('Perimetral (8 puntos)')).toBeOnTheScreen();
  expect(screen.getByText('Ana Paz')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Cómo llegar' }));
  expect(open).toHaveBeenCalledWith(
    'https://www.google.com/maps/dir/?api=1&destination=-31.4,-64.1',
  );
});

it('sin señal muestra lo guardado y avisa de cuándo es', async () => {
  jest.mocked(apiGet).mockResolvedValueOnce([site]);
  const first = await render(<SitesScreen />);
  expect(await screen.findByText('Parque Ferreyra')).toBeOnTheScreen();
  await first.unmount();

  jest.mocked(apiGet).mockRejectedValue(new Error('offline'));
  await render(<SitesScreen />);
  expect(await screen.findByText(/Sin conexión. Mostrando lo guardado/)).toBeOnTheScreen();
  expect(screen.getByText('Parque Ferreyra')).toBeOnTheScreen();
});

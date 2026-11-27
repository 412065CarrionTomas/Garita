import { fireEvent, render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GuardRoundVersion } from '@garita/shared';
import { apiGet } from '@/lib/api-client';
import { clearRoundVersionsMemory } from '@/lib/round-versions';
import { RoundScreen } from './round-screen';

// El mapa es nativo: en los tests se reemplaza por su descripción accesible.
jest.mock('./route-map', () => ({
  RouteMap: ({ label }: { label: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>{label}</Text>;
  },
}));
jest.mock('@/lib/api-client', () => {
  const actual = jest.requireActual('@/lib/api-client');
  return { ...actual, apiGet: jest.fn() };
});

const version: GuardRoundVersion = {
  id: 'v1',
  roundId: 'r1',
  name: 'Perimetral',
  frequencyMinutes: 60,
  windowStartLocal: '22:00',
  windowEndLocal: '06:00',
  checkpoints: [
    { id: 'a', name: 'Portón', latitude: -31.4, longitude: -64.2, isIndoor: false },
    { id: 'b', name: 'Galpón', latitude: -31.5, longitude: -64.1, isIndoor: true },
    { id: 'c', name: 'Tanque', latitude: -31.6, longitude: -64.1, isIndoor: false },
  ],
  route: null,
};

beforeEach(async () => {
  jest.clearAllMocks();
  clearRoundVersionsMemory();
  await AsyncStorage.clear();
});

it('muestra el mapa y los puntos en orden con lo marcado y el siguiente', async () => {
  jest.mocked(apiGet).mockResolvedValue([version]);
  await render(<RoundScreen versionIds={['v1']} done={['a']} next="b" />);
  expect(await screen.findByText(/Mapa con el recorrido Perimetral/)).toBeOnTheScreen();
  expect(screen.getByText('Cada 60 min · 22:00–06:00 · 3 puntos')).toBeOnTheScreen();
  expect(screen.getByText('1. Portón · marcado')).toBeOnTheScreen();
  expect(screen.getByText('2. Galpón (interior) · siguiente')).toBeOnTheScreen();
  expect(screen.getByText('3. Tanque')).toBeOnTheScreen();
});

it('avisa si no pudo cargar el recorrido', async () => {
  jest.mocked(apiGet).mockRejectedValue(new Error('offline'));
  await render(<RoundScreen versionIds={['v1']} />);
  expect(await screen.findByText(/No se pudo cargar el recorrido/)).toBeOnTheScreen();
});

it('no repite una ronda pedida dos veces ni avisa falta de señal si la API respondió', async () => {
  jest.mocked(apiGet).mockResolvedValue([version]);
  await render(<RoundScreen versionIds={['v1', 'v1', 'ajena']} />);
  expect(await screen.findAllByText('1. Portón')).toHaveLength(1);
  expect(screen.queryByText(/no se pudo cargar sin señal/)).toBeNull();
});

it('no desplaza la pantalla mientras hay un dedo sobre el mapa', async () => {
  jest.mocked(apiGet).mockResolvedValue([version]);
  await render(<RoundScreen versionIds={['v1']} />);
  const frame = await screen.findByTestId('route-map-frame');
  const scrollEnabled = () => screen.getByTestId('round-scroll').props.scrollEnabled;
  await fireEvent(frame, 'touchStart');
  expect(scrollEnabled()).toBe(false);
  // Al levantar uno de dos dedos (pellizco) sigue bloqueado.
  await fireEvent(frame, 'touchEnd', { nativeEvent: { touches: [{}] } });
  expect(scrollEnabled()).toBe(false);
  await fireEvent(frame, 'touchEnd', { nativeEvent: { touches: [] } });
  expect(scrollEnabled()).toBe(true);
});

import { fireEvent, render } from '@testing-library/react-native';
import { colors } from '@garita/tokens';

import {
  Badge,
  Banner,
  Button,
  Input,
  ListItem,
  Loading,
  PointWindowList,
  Text,
  ThemeProvider,
  ThemeSwitch,
  WindowBar,
} from '.';

it('Button se anuncia por su etiqueta y no dispara onPress mientras carga', async () => {
  const onPress = jest.fn();
  const view = await render(<Button label="Iniciar turno" onPress={onPress} />);
  await fireEvent.press(view.getByLabelText('Iniciar turno'));
  expect(onPress).toHaveBeenCalledTimes(1);

  await view.rerender(<Button label="Iniciar turno" onPress={onPress} loading />);
  await fireEvent.press(view.getByLabelText('Iniciar turno'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('Input nombra el campo con su etiqueta y anuncia el error', async () => {
  const view = await render(<Input label="Correo electrónico" error="Ingresá un correo válido" />);
  expect(view.getByLabelText('Correo electrónico')).toBeTruthy();
  expect(view.getByRole('alert')).toHaveTextContent('Ingresá un correo válido');
});

it('Banner es un alert por defecto y Badge, Loading y ListItem dicen su estado con texto', async () => {
  const view = await render(
    <>
      <Banner tone="danger">No hay señal</Banner>
      <Badge tone="success" label="Completada" />
      <Loading label="Cargando turnos…" />
      <ListItem title="Turno nocturno" subtitle="22:00 a 06:00" onPress={jest.fn()} />
    </>,
  );
  expect(view.getByRole('alert')).toHaveTextContent('No hay señal');
  expect(view.getByText('Completada')).toBeTruthy();
  expect(view.getByRole('progressbar')).toBeTruthy();
  expect(view.getByText('Turno nocturno')).toBeTruthy();
});

it('Text toma el color del token indicado', async () => {
  const view = await render(<Text color="mutedForeground">Secundario</Text>);
  expect(view.getByText('Secundario')).toHaveStyle({ color: colors.light.mutedForeground });
});

it('ThemeSwitch cambia la apariencia a oscuro', async () => {
  const view = await render(
    <ThemeProvider>
      <ThemeSwitch />
      <Text>Hola</Text>
    </ThemeProvider>,
  );
  await fireEvent.press(view.getByLabelText('Oscuro'));
  expect(view.getByText('Hola')).toHaveStyle({ color: colors.dark.foreground });
});

it('WindowBar se anuncia como una imagen con el conteo por estado', async () => {
  const view = await render(
    <WindowBar windows={['ontime', 'ontime', 'late', 'missed', 'pending']} />,
  );
  expect(
    view.getByLabelText('5 ventanas: 2 a tiempo, 1 tardía, 1 no realizada, 1 pendiente'),
  ).toBeTruthy();
});

it('PointWindowList nombra cada punto con su estado y marca el actual', async () => {
  const view = await render(
    <PointWindowList
      currentIndex={1}
      points={[
        { id: 'a', number: 1, name: 'Portón', status: 'done', time: '21:03' },
        { id: 'b', number: 2, name: 'Galpón', status: 'current', window: '21:00–22:00' },
        { id: 'c', number: 3, name: 'Tanque', status: 'pending', time: '21:20' },
      ]}
    />,
  );
  expect(view.getByLabelText('Punto 1, Portón, 21:03')).toBeTruthy();
  expect(view.getByLabelText('Punto 2, Galpón, Ahora')).toBeTruthy();
  expect(view.getByText('Ventana 21:00–22:00')).toBeTruthy();
});

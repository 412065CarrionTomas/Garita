import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAnnouncer } from './use-announcer';
import { useKeyboardGrab, type KeyboardGrabOptions } from './use-keyboard-grab';

function Handle(props: KeyboardGrabOptions) {
  const { grabbed, onKeyDown, onBlur } = useKeyboardGrab(props);
  return (
    <>
      <button type="button" aria-pressed={grabbed} onKeyDown={onKeyDown} onBlur={onBlur}>
        Asa
      </button>
      <button type="button">Otro</button>
    </>
  );
}

function setup(overrides: Partial<KeyboardGrabOptions> = {}) {
  const mocks = {
    onGrab: jest.fn(() => true),
    onStep: jest.fn(),
    onDrop: jest.fn(),
    onCancel: jest.fn(),
  };
  render(<Handle {...mocks} {...overrides} />);
  return {
    user: userEvent.setup(),
    handle: screen.getByRole('button', { name: 'Asa' }),
    ...mocks,
  };
}

it('toma con Enter, mueve con flechas y suelta con Espacio', async () => {
  const { user, handle, onGrab, onStep, onDrop } = setup();
  handle.focus();
  await user.keyboard('{ArrowDown}');
  expect(onStep).not.toHaveBeenCalled();
  await user.keyboard('{Enter}');
  expect(onGrab).toHaveBeenCalledTimes(1);
  expect(handle).toHaveAttribute('aria-pressed', 'true');
  await user.keyboard('{ArrowDown}{ArrowLeft}');
  expect(onStep.mock.calls).toEqual([['down'], ['left']]);
  await user.keyboard(' ');
  expect(onDrop).toHaveBeenCalledTimes(1);
  expect(handle).toHaveAttribute('aria-pressed', 'false');
});

it('Escape cancela y perder el foco suelta', async () => {
  const { user, handle, onCancel, onDrop } = setup();
  handle.focus();
  await user.keyboard('{Enter}{Escape}');
  expect(onCancel).toHaveBeenCalledTimes(1);
  await user.keyboard('{Enter}');
  await user.tab();
  expect(onDrop).toHaveBeenCalledTimes(1);
});

it('no toma si el consumidor lo impide y solo atiende las flechas pedidas', async () => {
  const blocked = setup({ onGrab: jest.fn(() => false) });
  blocked.handle.focus();
  await blocked.user.keyboard('{Enter}');
  expect(blocked.handle).toHaveAttribute('aria-pressed', 'false');
});

it('atiende solo las flechas pedidas', async () => {
  const { user, handle, onStep } = setup({ arrows: ['up', 'down'] });
  handle.focus();
  await user.keyboard('{Enter}{ArrowLeft}{ArrowUp}');
  expect(onStep.mock.calls).toEqual([['up']]);
});

function Speaker({ message }: { message: string }) {
  const { announce, region } = useAnnouncer();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          announce(message);
        }}
      >
        Anunciar
      </button>
      {region}
    </>
  );
}

it('anuncia en una región en vivo y repite mensajes iguales', async () => {
  const user = userEvent.setup();
  render(<Speaker message="Movido" />);
  const region = screen.getByTestId('announcer');
  expect(region).toHaveAttribute('aria-live', 'polite');
  await user.click(screen.getByRole('button', { name: 'Anunciar' }));
  expect(await screen.findByText('Movido')).toBe(region);
  await user.click(screen.getByRole('button', { name: 'Anunciar' }));
  expect(region).toHaveTextContent('');
  expect(await screen.findByText('Movido')).toBe(region);
});

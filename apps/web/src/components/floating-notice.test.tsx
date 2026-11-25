import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FloatingNotice, NOTICE_MS } from './floating-notice';

describe('FloatingNotice', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('se cierra con la X', async () => {
    const onClose = jest.fn();
    render(<FloatingNotice text="Listo" onClose={onClose} />);
    expect(screen.getByRole('status')).toHaveTextContent('Listo');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('se cierra solo a los 10 s aunque cambie onClose', () => {
    jest.useFakeTimers();
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = render(<FloatingNotice text="Falló" tone="danger" onClose={first} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Falló');
    act(() => {
      jest.advanceTimersByTime(NOTICE_MS - 1);
    });
    rerender(<FloatingNotice text="Falló" tone="danger" onClose={second} />);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('no se cierra mientras el mouse está encima y el plazo vuelve a empezar al salir', () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    render(<FloatingNotice text="Largo" onClose={onClose} />);
    const notice = screen.getByRole('status');
    act(() => {
      jest.advanceTimersByTime(NOTICE_MS - 1);
    });
    fireEvent.mouseEnter(notice);
    act(() => {
      jest.advanceTimersByTime(NOTICE_MS * 2);
    });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseLeave(notice);
    act(() => {
      jest.advanceTimersByTime(NOTICE_MS - 1);
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

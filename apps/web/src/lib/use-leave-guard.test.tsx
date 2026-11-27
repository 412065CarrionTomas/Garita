import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLeaveGuard } from './use-leave-guard';

const navigate = jest.fn();
jest.mock('react-router', () => ({
  ...jest.requireActual<Record<string, unknown>>('react-router'),
  useNavigate: () => navigate,
}));

function Screen({ dirty }: { dirty: boolean }) {
  const dialog = useLeaveGuard(dirty);
  return (
    <>
      {dialog}
      <a href="/turnos">Turnos</a>
      <a href="https://externo.example/">Externo</a>
      <a href="/turnos" target="_blank">
        Nueva pestaña
      </a>
    </>
  );
}

beforeEach(() => {
  navigate.mockReset();
});

it('con cambios, un enlace interno pide confirmación antes de salir', async () => {
  const user = userEvent.setup();
  render(<Screen dirty />);
  await user.click(screen.getByRole('link', { name: 'Turnos' }));
  const dialog = await screen.findByRole('alertdialog', { name: '¿Salir sin guardar?' });
  await user.click(screen.getByRole('button', { name: 'Seguir editando' }));
  expect(dialog).not.toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
  await user.click(screen.getByRole('link', { name: 'Turnos' }));
  await user.click(await screen.findByRole('button', { name: 'Salir sin guardar' }));
  expect(navigate).toHaveBeenCalledWith('/turnos');
});

it('sin cambios no interviene', () => {
  render(<Screen dirty={false} />);
  const event = fireEvent.click(screen.getByRole('link', { name: 'Turnos' }));
  expect(event).toBe(true);
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('no intercepta enlaces externos, nuevas pestañas ni clics con Ctrl', () => {
  render(<Screen dirty />);
  fireEvent.click(screen.getByRole('link', { name: 'Externo' }));
  fireEvent.click(screen.getByRole('link', { name: 'Nueva pestaña' }));
  fireEvent.click(screen.getByRole('link', { name: 'Turnos' }), { ctrlKey: true });
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('con cambios, cerrar o recargar pide confirmación al navegador', () => {
  const { unmount } = render(<Screen dirty />);
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  unmount();
  const after = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});

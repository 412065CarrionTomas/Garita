import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ThemeProvider, useTheme } from './theme';

function Probe() {
  const { mode, setMode } = useTheme();
  return (
    <>
      <output>{mode}</output>
      <button
        type="button"
        onClick={() => {
          setMode('dark');
        }}
      >
        oscuro
      </button>
      <button
        type="button"
        onClick={() => {
          setMode('light');
        }}
      >
        claro
      </button>
      <button
        type="button"
        onClick={() => {
          setMode('system');
        }}
      >
        sistema
      </button>
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

it('aplica y recuerda el tema oscuro, y vuelve al del sistema', async () => {
  const user = userEvent.setup();
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );

  await user.click(screen.getByRole('button', { name: 'oscuro' }));
  expect(document.documentElement).toHaveClass('dark');
  expect(localStorage.getItem('garita-theme')).toBe('dark');

  await user.click(screen.getByRole('button', { name: 'claro' }));
  expect(document.documentElement).not.toHaveClass('dark');
  expect(screen.getByRole('status')).toHaveTextContent('light');

  await user.click(screen.getByRole('button', { name: 'sistema' }));
  expect(localStorage.getItem('garita-theme')).toBeNull();
});

it('arranca con el tema guardado', () => {
  localStorage.setItem('garita-theme', 'dark');
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  expect(document.documentElement).toHaveClass('dark');
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ThemeToggle } from '@/components/theme-toggle';
import { ThemeProvider } from './theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

it('aplica y recuerda el tema oscuro, y vuelve al del sistema', async () => {
  const user = userEvent.setup();
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );

  await user.click(screen.getByRole('button', { name: 'Tema oscuro' }));
  expect(document.documentElement).toHaveClass('dark');
  expect(localStorage.getItem('garita-theme')).toBe('dark');

  await user.click(screen.getByRole('button', { name: 'Tema claro' }));
  expect(document.documentElement).not.toHaveClass('dark');
  expect(screen.getByRole('button', { name: 'Tema claro' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await user.click(screen.getByRole('button', { name: 'Tema del sistema' }));
  expect(localStorage.getItem('garita-theme')).toBeNull();
});

it('arranca con el tema guardado', () => {
  localStorage.setItem('garita-theme', 'dark');
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
  expect(document.documentElement).toHaveClass('dark');
});

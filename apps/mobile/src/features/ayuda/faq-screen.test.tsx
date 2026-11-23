import { fireEvent, render } from '@testing-library/react-native';
import { faqEntries } from '@garita/shared';
import type { AuthMeResponse } from '@garita/shared';
import { useAuth } from '../auth/auth-context';
import { FaqScreen } from './faq-screen';

jest.mock('expo-router', () => ({
  ...jest.requireActual<Record<string, unknown>>('@/test/expo-router'),
  router: { replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
}));
jest.mock('../auth/auth-context', () => ({ useAuth: jest.fn() }));
const useAuthMock = jest.mocked(useAuth);

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

function mockUser(user: AuthMeResponse | null) {
  useAuthMock.mockReturnValue({ user } as ReturnType<typeof useAuth>);
}

const visibleFor = (audience: string) =>
  faqEntries.filter(
    (entry) => entry.audiences.includes('public') || entry.audiences.includes(audience as 'guard'),
  );

describe('FaqScreen', () => {
  it('sin sesión muestra solo lo general', async () => {
    mockUser(null);
    const screen = await render(<FaqScreen />);
    for (const entry of faqEntries) {
      const shown = screen.queryByRole('button', { name: entry.question });
      if (entry.audiences.includes('public')) expect(shown).toBeTruthy();
      else expect(shown).toBeNull();
    }
  });

  it('al vigilador le suma sus preguntas y despliega la respuesta al tocarla', async () => {
    mockUser(guard);
    const screen = await render(<FaqScreen />);
    const entries = visibleFor('guard');
    for (const entry of entries)
      expect(screen.getByRole('button', { name: entry.question })).toBeTruthy();
    const target = entries.find((entry) => entry.audiences.includes('guard'));
    if (!target) throw new Error('Falta contenido para el vigilador');
    const question = screen.getByRole('button', { name: target.question });
    expect(question.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(question);
    expect(
      screen.getByRole('button', { name: target.question }).props.accessibilityState,
    ).toMatchObject({
      expanded: true,
    });
    expect(screen.getByText(target.answer[0]?.split('**')[0] ?? '', { exact: false })).toBeTruthy();
  });

  it('avisa cuando la búsqueda no encuentra nada', async () => {
    mockUser(guard);
    const screen = await render(<FaqScreen />);
    await fireEvent.changeText(
      screen.getByLabelText('Buscar en las preguntas'),
      'zzzz-sin-coincidencias',
    );
    expect(screen.getByText('Sin resultados. Probá con otra palabra.')).toBeTruthy();
  });
});

import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { faqEntries } from '@garita/shared';

import { useAuth } from '../auth/auth-context';
import { AppRoutes, PublicFaqRoute } from '../auth/routes';

jest.mock('../auth/auth-context', () => ({ useAuth: jest.fn() }));
const useAuthMock = jest.mocked(useAuth);

function mockSession(loading: boolean) {
  useAuthMock.mockReturnValue({
    user: null,
    loading,
    login: jest.fn(),
    logout: jest.fn(),
    recover: jest.fn(),
    acceptLegal: jest.fn(),
    error: '',
    clearError: jest.fn(),
  });
}

describe('PublicFaqRoute', () => {
  it('espera la sesión en lugar de mostrar la vista pública', () => {
    mockSession(true);
    render(
      <MemoryRouter>
        <PublicFaqRoute />
      </MemoryRouter>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Verificando sesión…');
    expect(screen.queryByRole('link', { name: 'Iniciar sesión' })).not.toBeInTheDocument();
  });

  it('sin sesión muestra la ayuda pública', () => {
    mockSession(false);
    render(
      <MemoryRouter>
        <PublicFaqRoute />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute(
      'href',
      '/ingresar',
    );
  });
});

/** Rutas hijas de un elemento `<Routes>` o `<Route>`, sin los `false` de las condicionales. */
function routesOf(element: ReactElement): ReactElement<RouteProps>[] {
  const { children } = element.props as { children?: ReactNode };
  return Children.toArray(children).filter(isValidElement) as ReactElement<RouteProps>[];
}
interface RouteProps {
  path?: string;
  element?: ReactElement;
  children?: ReactNode;
}

describe('AppRoutes', () => {
  it('con sesión, /ayuda vive dentro del layout del panel y no lo vuelve a montar', () => {
    useAuthMock.mockReturnValue({
      user: {
        id: 'u1',
        firstName: 'Ana',
        lastName: 'López',
        email: 'ana@example.com',
        role: 'supervisor',
        status: 'active',
        company: { id: 'c1', name: 'Norte' },
        allowedChannels: ['web'],
      },
      loading: false,
      login: jest.fn(),
      logout: jest.fn(),
      recover: jest.fn(),
      acceptLegal: jest.fn(),
      error: '',
      clearError: jest.fn(),
    });
    const top = routesOf(AppRoutes());
    expect(top.some((route) => route.props.path === '/ayuda')).toBe(false);
    const [layout, ...others] = top.filter((route) => !route.props.path && route.props.element);
    expect(others).toHaveLength(0);
    if (!layout) throw new Error('Falta el layout del panel');
    expect(routesOf(layout).some((route) => route.props.path === '/ayuda')).toBe(true);
  });

  it('cada enlace de la ayuda abre una pantalla permitida para todos los roles de su pregunta', () => {
    useAuthMock.mockReturnValue({
      user: { role: 'admin' },
      loading: false,
    } as ReturnType<typeof useAuth>);
    const layout = routesOf(AppRoutes()).find((route) => !route.props.path && route.props.element);
    if (!layout) throw new Error('Falta el layout del panel');
    const allowed = new Map(
      routesOf(layout).map((route) => {
        const guard = route.props.element?.props as { roles?: readonly string[] } | undefined;
        return [route.props.path, guard?.roles ?? []] as const;
      }),
    );
    for (const entry of faqEntries) {
      if (!entry.link) continue;
      const roles = allowed.get(entry.link.path.split('?')[0]);
      expect([entry.id, roles !== undefined]).toEqual([entry.id, true]);
      for (const audience of entry.audiences)
        expect([entry.id, audience, roles?.includes(audience)]).toEqual([entry.id, audience, true]);
    }
  });

  it('sin sesión, /ayuda es la página pública fuera del panel', () => {
    mockSession(false);
    const top = routesOf(AppRoutes());
    const faq = top.find((route) => route.props.path === '/ayuda');
    expect(faq?.props.element?.type).toBe(PublicFaqRoute);
    const layout = top.find((route) => !route.props.path && route.props.element);
    expect(layout && routesOf(layout).some((route) => route.props.path === '/ayuda')).toBe(false);
  });
});

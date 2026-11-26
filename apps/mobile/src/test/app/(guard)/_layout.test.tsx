import { act, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import GuardLayout from '@/app/(guard)/_layout';
import { checkFieldPermissions } from '@/features/permisos/permissions';
import { createDefaultFieldRepository, subscribePanicChanges } from '@/lib/db/database';

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    const React = jest.requireActual('react') as {
      createElement: (type: unknown, props: null, children: string) => ReactNode;
    };
    const { Text } = jest.requireActual('react-native') as { Text: unknown };
    return React.createElement(Text, null, href);
  },
  Stack: () => {
    const React = jest.requireActual('react') as {
      createElement: (type: unknown, props: null, children: string) => ReactNode;
    };
    const { Text } = jest.requireActual('react-native') as { Text: unknown };
    return React.createElement(Text, null, 'GuardStack');
  },
  usePathname: jest.fn(() => '/'),
}));
let mockUser: { id?: string; role: 'guard'; legalAcceptanceRequired?: boolean } = {
  role: 'guard',
};
jest.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));
jest.mock('@/features/permisos/permissions', () => ({ checkFieldPermissions: jest.fn() }));
jest.mock('@/lib/db/database', () => ({
  createDefaultFieldRepository: jest.fn(async () => ({ getShiftData: async () => null })),
  subscribePanicChanges: jest.fn(() => () => undefined),
}));
jest.mock('@/features/navegacion/guard-header', () => ({ GuardHeader: () => null }));
jest.mock('@/features/navegacion/guard-bar', () => ({
  GuardBar: ({ shiftId }: { shiftId: string | null }) => {
    const React = jest.requireActual('react');
    const { Text } = jest.requireActual('react-native');
    return React.createElement(Text, null, `bar:${shiftId ?? 'none'}`);
  },
  GUARD_BAR_HEIGHT: 64,
}));
jest.mock('@/features/panico/panic-overlay', () => ({
  PanicOverlay: () => {
    const React = jest.requireActual('react');
    const { Text } = jest.requireActual('react-native');
    return React.createElement(Text, null, 'PanicOverlay');
  },
}));

describe('guard permissions gate', () => {
  it('redirects initial guard entry to permission setup when requirements are missing', async () => {
    jest.mocked(checkFieldPermissions).mockResolvedValue('location_denied');
    await act(async () => {
      await render(<GuardLayout />);
      await Promise.resolve();
    });
    expect(screen.getByText('/permisos')).toBeOnTheScreen();
  });

  it('pide aceptar los términos vigentes aunque se entre directo al área (p. ej. por notificación)', async () => {
    mockUser = { id: 'g1', role: 'guard', legalAcceptanceRequired: true };
    jest.mocked(checkFieldPermissions).mockResolvedValue('ok');
    jest
      .mocked(createDefaultFieldRepository)
      .mockResolvedValue({ getShiftData: async () => null } as never);
    try {
      await render(<GuardLayout />);
      await waitFor(() => expect(screen.getByText('/aceptar-terminos')).toBeOnTheScreen());
    } finally {
      mockUser = { role: 'guard' };
    }
  });

  it('opens the guard routes when permissions are ready', async () => {
    jest.mocked(checkFieldPermissions).mockResolvedValue('ok');
    await act(async () => {
      await render(<GuardLayout />);
      await Promise.resolve();
    });
    expect(screen.getByText('GuardStack')).toBeOnTheScreen();
  });

  it('restores a locally saved in-progress shift on app entry', async () => {
    jest.mocked(checkFieldPermissions).mockResolvedValue('ok');
    jest
      .mocked(createDefaultFieldRepository)
      .mockResolvedValue({ getShiftData: async () => ({ shift: { id: 'saved-shift' } }) } as never);
    await act(async () => {
      await render(<GuardLayout />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText('/turno/saved-shift')).toBeOnTheScreen();
  });

  it('H1: shows panic on local start and hides it on offline close without navigation', async () => {
    const { usePathname } = jest.requireMock('expo-router') as { usePathname: jest.Mock };
    usePathname.mockReturnValue('/turno/saved-shift');
    jest.mocked(checkFieldPermissions).mockResolvedValue('ok');
    let saved: { shift: { id: string } } | null = null;
    let closed = false;
    // Como la base real: avisa a todos los suscriptos (pánico y turno guardado).
    const listeners = new Set<() => void>();
    const changed = () => listeners.forEach((listener) => listener());
    jest.mocked(subscribePanicChanges).mockImplementation((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    jest.mocked(createDefaultFieldRepository).mockResolvedValue({
      getShiftData: async () => saved,
      getSyncMeta: async () => null,
      listPendingEvents: async () =>
        closed ? [{ type: 'shift_close', payload: { shiftId: 'saved-shift' } }] : [],
    } as never);
    await render(<GuardLayout />);
    await waitFor(() => expect(screen.getByText('GuardStack')).toBeOnTheScreen());
    expect(screen.queryByText('PanicOverlay')).toBeNull();
    await act(async () => {
      saved = { shift: { id: 'saved-shift' } };
      changed();
    });
    await waitFor(() => expect(screen.getByText('PanicOverlay')).toBeOnTheScreen());
    await act(async () => {
      closed = true;
      changed();
    });
    await waitFor(() => expect(screen.queryByText('PanicOverlay')).toBeNull());
    expect(screen.getByText('GuardStack')).toBeOnTheScreen();
  });

  it('con turno iniciado deja ver Turnos sin volver a la Ronda', async () => {
    const { usePathname } = jest.requireMock('expo-router') as { usePathname: jest.Mock };
    usePathname.mockReturnValue('/turnos');
    jest.mocked(checkFieldPermissions).mockResolvedValue('ok');
    jest
      .mocked(createDefaultFieldRepository)
      .mockResolvedValue({ getShiftData: async () => ({ shift: { id: 'saved-shift' } }) } as never);
    await render(<GuardLayout />);
    await waitFor(() => expect(screen.getByText('GuardStack')).toBeOnTheScreen());
    expect(screen.queryByText('/turno/saved-shift')).toBeNull();
  });

  it('al iniciar el turno sin cambiar de ruta, la barra pasa a la Ronda', async () => {
    const { usePathname } = jest.requireMock('expo-router') as { usePathname: jest.Mock };
    usePathname.mockReturnValue('/turno/new');
    jest.mocked(checkFieldPermissions).mockResolvedValue('ok');
    const listeners = new Set<() => void>();
    jest.mocked(subscribePanicChanges).mockImplementation((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    let saved: { shift: { id: string } } | null = null;
    jest
      .mocked(createDefaultFieldRepository)
      .mockResolvedValue({ getShiftData: async () => saved } as never);
    await render(<GuardLayout />);
    await waitFor(() => expect(screen.getByText('GuardStack')).toBeOnTheScreen());
    expect(screen.getByText('bar:none')).toBeOnTheScreen();
    await act(async () => {
      saved = { shift: { id: 'new' } };
      listeners.forEach((listener) => listener());
    });
    await waitFor(() => expect(screen.getByText('bar:new')).toBeOnTheScreen());
  });
});

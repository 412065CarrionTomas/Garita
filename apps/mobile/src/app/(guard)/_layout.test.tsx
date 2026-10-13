import { act, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import GuardLayout from './_layout';
import { checkFieldPermissions } from '@/features/permisos/permissions';
import { createDefaultFieldRepository } from '@/lib/db/database';

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
  usePathname: () => '/(guard)',
}));
jest.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ user: { role: 'guard' }, loading: false }),
}));
jest.mock('@/features/permisos/permissions', () => ({ checkFieldPermissions: jest.fn() }));
jest.mock('@/lib/db/database', () => ({
  createDefaultFieldRepository: jest.fn(async () => ({ getShiftData: async () => null })),
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
});

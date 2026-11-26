import { render, userEvent } from '@testing-library/react-native';
import PermissionsScreen from '@/app/permisos';
import * as Permissions from '@/features/permisos/permissions';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock('@/features/permisos/permissions', () => ({
  requestFieldPermissions: jest.fn(),
  checkFieldPermissions: jest.fn(),
}));
describe('permissions setup screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Al entrar por primera vez todavía no hay permisos.
    jest.mocked(Permissions.checkFieldPermissions).mockResolvedValue('location_denied');
  });

  it('explains location and camera, then requests permissions accessibly', async () => {
    jest.mocked(Permissions.requestFieldPermissions).mockResolvedValue('ok');
    const user = userEvent.setup();
    const screen = await render(<PermissionsScreen />);
    expect(screen.getByText(/Ley 25\.326/)).toBeTruthy();
    expect(screen.getByText(/códigos QR/)).toBeTruthy();
    expect(screen.queryByText(/servidor/)).toBeNull();
    await user.press(screen.getByRole('button', { name: 'Permitir ubicación precisa' }));
    expect(await screen.findByText(/permisos están listos/)).toBeTruthy();
    expect(Permissions.requestFieldPermissions).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Siguiente: ir a mis turnos' })).toBeTruthy();
    expect(screen.getAllByText('Permitida')).toHaveLength(2);
    expect(
      screen
        .getAllByRole('text', { name: 'Los permisos están listos para iniciar tu turno.' })
        .some((element) => element.props.accessibilityLiveRegion === 'polite'),
    ).toBe(true);
  });

  it('arriving with permissions given but location off, shows Siguiente right away', async () => {
    jest.mocked(Permissions.checkFieldPermissions).mockResolvedValue('location_services_off');
    const screen = await render(<PermissionsScreen />);
    expect(await screen.findByText(/Activá la ubicación del celular/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Siguiente: ir a mis turnos' })).toBeTruthy();
  });

  it('lets the guard continue after turning on location services without asking again', async () => {
    jest.mocked(Permissions.requestFieldPermissions).mockResolvedValue('location_services_off');
    jest
      .mocked(Permissions.checkFieldPermissions)
      .mockResolvedValueOnce('location_denied')
      .mockResolvedValueOnce('location_services_off')
      .mockResolvedValueOnce('ok');
    const user = userEvent.setup();
    const screen = await render(<PermissionsScreen />);
    await user.press(await screen.findByRole('button', { name: 'Permitir ubicación precisa' }));
    expect(await screen.findByText(/Activá la ubicación del celular/)).toBeTruthy();
    expect(screen.getAllByText('Permitida')).toHaveLength(2);

    const next = screen.getByRole('button', { name: 'Siguiente: ir a mis turnos' });
    await user.press(next);
    expect(mockReplace).not.toHaveBeenCalled();
    await user.press(next);
    expect(mockReplace).toHaveBeenCalledWith('/(guard)');
    expect(Permissions.requestFieldPermissions).toHaveBeenCalledTimes(1);
  });
});

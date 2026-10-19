import { render, userEvent } from '@testing-library/react-native';
import PermissionsScreen from '@/app/permisos';
import * as Permissions from '@/features/permisos/permissions';

jest.mock('@/features/permisos/permissions', () => ({ requestFieldPermissions: jest.fn() }));
describe('permissions setup screen', () => {
  it('explains location and camera, then requests permissions accessibly', async () => {
    jest.mocked(Permissions.requestFieldPermissions).mockResolvedValue('ok');
    const user = userEvent.setup();
    const screen = await render(<PermissionsScreen />);
    expect(screen.getByText(/Ley 25\.326/)).toBeTruthy();
    expect(screen.getByText(/códigos QR/)).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Permitir ubicación precisa y cámara' }));
    expect(await screen.findByText(/permisos están listos/)).toBeTruthy();
    expect(Permissions.requestFieldPermissions).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Continuar a mis turnos' })).toBeTruthy();
    expect(
      screen
        .getAllByRole('text', { name: 'Los permisos están listos para iniciar tu turno.' })
        .some((element) => element.props.accessibilityLiveRegion === 'polite'),
    ).toBe(true);
  });
});

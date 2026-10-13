import { fireEvent, render, waitFor } from '@testing-library/react-native';
import PermissionsScreen from './permisos';
import * as Permissions from '../features/permisos/permissions';

jest.mock('../features/permisos/permissions', () => ({ requestFieldPermissions: jest.fn() }));
describe('permissions setup screen', () => {
  it('explains location and camera, then requests permissions accessibly', async () => {
    jest.mocked(Permissions.requestFieldPermissions).mockResolvedValue('ok');
    const screen = await render(<PermissionsScreen />);
    expect(screen.getByText(/Ley 25\.326/)).toBeTruthy();
    expect(screen.getByText(/códigos QR/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Permitir ubicación precisa y cámara' }));
    await waitFor(() => expect(screen.getByText(/permisos están listos/)).toBeTruthy());
    expect(Permissions.requestFieldPermissions).toHaveBeenCalledTimes(1);
  });
});

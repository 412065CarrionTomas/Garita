import {
  CLIENT_MESSAGE,
  DISABLED_MESSAGE,
  RESET_MESSAGE,
  firebaseErrorMessage,
} from './auth-context';
import { ApiError } from '@/lib/api-client';

describe('mensajes de autenticación móvil', () => {
  it('no diferencia correo y contraseña incorrectos', () => {
    expect(firebaseErrorMessage({ code: 'auth/invalid-credential' })).toBe(
      'Correo o contraseña incorrectos',
    );
  });
  it('muestra errores de cuenta deshabilitada y bloqueo temporal', () => {
    expect(firebaseErrorMessage({ code: 'auth/user-disabled' })).toBe(DISABLED_MESSAGE);
    expect(firebaseErrorMessage(new ApiError('forbidden', 403))).toBe(DISABLED_MESSAGE);
    expect(firebaseErrorMessage({ code: 'auth/too-many-requests' })).toContain('Esperá');
  });
  it('indica el canal para el cliente y usa el mismo texto de recuperación', () => {
    expect(CLIENT_MESSAGE).toBe('Tu usuario se usa desde el panel web de Garita');
    expect(RESET_MESSAGE).toBe(
      'Si el correo está registrado, te enviamos un enlace para restablecer tu contraseña',
    );
  });
});

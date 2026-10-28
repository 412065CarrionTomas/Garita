import {
  firebaseErrorMessage,
  DISABLED_MESSAGE,
  WEB_GUARD_MESSAGE,
  RESET_MESSAGE,
} from './auth-context';
import { ApiError } from '@/lib/api-client';

describe('mensajes de autenticación web', () => {
  it('usa el mismo mensaje genérico para errores de credenciales', () => {
    expect(firebaseErrorMessage({ code: 'auth/invalid-credential' })).toBe(
      'Correo o contraseña incorrectos',
    );
  });

  it('informa usuario deshabilitado y demasiados intentos', () => {
    expect(firebaseErrorMessage({ code: 'auth/user-disabled' })).toBe(DISABLED_MESSAGE);
    expect(firebaseErrorMessage(new ApiError('forbidden', 403))).toBe(DISABLED_MESSAGE);
    expect(firebaseErrorMessage({ code: 'auth/too-many-requests' })).toContain('Esperá');
  });

  it('conserva los textos de canal y recuperación acordados', () => {
    expect(WEB_GUARD_MESSAGE).toBe('Tu usuario se usa desde la app móvil de Garita');
    expect(RESET_MESSAGE).toBe(
      'Si el correo está registrado, te enviamos un enlace para restablecer tu contraseña',
    );
  });
});

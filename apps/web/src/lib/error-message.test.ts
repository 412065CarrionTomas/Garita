import { ApiError } from './api-client';
import { errorMessage } from './error-message';

describe('errorMessage', () => {
  it('muestra el mensaje del backend en errores 4xx', () => {
    const error = new ApiError('x', 400, { message: 'El correo ya está en uso' });
    expect(errorMessage(error)).toBe('El correo ya está en uso');
  });
  it('no muestra textos genéricos de 403 ni 5xx', () => {
    expect(errorMessage(new ApiError('Sin permiso', 403, { message: 'Forbidden resource' }))).toBe(
      'Sin permiso',
    );
    expect(errorMessage(new ApiError('Falló', 500, { message: 'Internal server error' }))).toBe(
      'Falló',
    );
  });
});

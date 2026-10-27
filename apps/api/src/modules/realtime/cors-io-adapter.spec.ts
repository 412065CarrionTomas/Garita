import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';

import { CorsIoAdapter } from './cors-io-adapter';

describe('CorsIoAdapter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('pasa los orígenes permitidos a Socket.IO', () => {
    const createIOServer = jest
      .spyOn(IoAdapter.prototype, 'createIOServer')
      .mockReturnValue({} as ReturnType<IoAdapter['createIOServer']>);
    const adapter = new CorsIoAdapter({} as INestApplicationContext, ['http://localhost:5173']);

    adapter.createIOServer(3000);

    expect(createIOServer).toHaveBeenCalledWith(3000, {
      cors: { origin: ['http://localhost:5173'] },
    });
  });

  it('conserva las opciones del gateway al agregar CORS', () => {
    const createIOServer = jest
      .spyOn(IoAdapter.prototype, 'createIOServer')
      .mockReturnValue({} as ReturnType<IoAdapter['createIOServer']>);
    const adapter = new CorsIoAdapter({} as INestApplicationContext, ['http://localhost:5173']);

    adapter.createIOServer(3000, { maxHttpBufferSize: 1024 });

    expect(createIOServer).toHaveBeenCalledWith(3000, {
      maxHttpBufferSize: 1024,
      cors: { origin: ['http://localhost:5173'] },
    });
  });
});

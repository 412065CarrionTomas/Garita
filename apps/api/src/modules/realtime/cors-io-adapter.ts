import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/**
 * Socket.IO no hereda el CORS de `app.enableCors`: sin estas opciones el navegador
 * bloquea el polling desde el panel web.
 */
export class CorsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[],
  ) {
    super(app);
  }

  override createIOServer(
    port: number,
    options?: Partial<ServerOptions>,
  ): ReturnType<IoAdapter['createIOServer']> {
    // Nest pasa solo las opciones del gateway (parciales); el tipo de socket.io pide todas.
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins },
    } as ServerOptions);
  }
}

import { Controller, Get } from '@nestjs/common';
import type { LiveHealthResponse } from '@garita/shared';

@Controller('health')
export class HealthController {
  /** Indica que el proceso está vivo. No consulta dependencias externas. */
  @Get('live')
  live(): LiveHealthResponse {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}

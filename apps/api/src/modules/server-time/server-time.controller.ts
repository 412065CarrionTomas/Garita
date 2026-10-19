import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CLOCK, type Clock } from '../../common/clock';
import { Public } from '../auth/auth.decorators';

@ApiTags('Hora confiable')
@Controller({ path: 'hora', version: '1' })
export class ServerTimeController {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  @Get()
  @Public()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Referencia pública de hora UTC, sin datos de usuarios ni turnos' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['serverTime'],
      properties: { serverTime: { type: 'string', format: 'date-time' } },
    },
  })
  getTime() {
    return { serverTime: this.clock.now().toISOString() };
  }
}

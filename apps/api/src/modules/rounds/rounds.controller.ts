import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { previewRoundSchema, roundInputSchema } from '@garita/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RoundsService } from './rounds.service';

@Controller()
@ApiTags('rondas')
@ApiBearerAuth()
export class RoundsController {
  constructor(private readonly rounds: RoundsService) {}
  @Get('predios/:id/rondas')
  @Roles('admin', 'supervisor')
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  list(@Param('id') id: string) {
    return this.rounds.list(id);
  }
  @Post('predios/:id/rondas')
  @Roles('admin', 'supervisor')
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409 })
  create(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = roundInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.rounds.create(id, parsed.data, user);
  }
  @Patch('rondas/:id')
  @Roles('admin', 'supervisor')
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409 })
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const parsed = roundInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.rounds.update(id, parsed.data, user);
  }
  @Post('rondas/:id/baja')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'supervisor')
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.rounds.deactivate(id, user);
  }
  @Post('rondas/previsualizar-ventanas')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'supervisor')
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  preview(@Body() body: unknown) {
    const parsed = previewRoundSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return this.rounds.preview(parsed.data);
  }
}

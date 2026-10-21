import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ConnectionNoticeRequest, ConnectionNoticeResponse } from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CLOCK, type Clock } from '../../common/clock';
import { REALTIME_PORT, type RealtimePort } from '../../common/ports/realtime.port';
import { RoundWindowStateService } from '../supervision/round-window-state.service';

@Injectable()
export class ShiftSyncStateService {
  private readonly logger = new Logger(ShiftSyncStateService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() private readonly windowStates?: RoundWindowStateService,
    @Optional() @Inject(REALTIME_PORT) private readonly realtime?: RealtimePort,
  ) {}

  async updateSyncState(params: {
    companyId: string;
    shiftId: string;
    pendingCount: number;
    syncedUntil: Date | null;
    contactAt: Date;
    isBatch: boolean;
  }): Promise<void> {
    // systemPrisma se usa para gestionar el estado de sincronización del turno de forma centralizada
    const existing = await this.prisma.systemPrisma.shiftSyncState.findUnique({
      where: { shiftId: params.shiftId },
    });

    let newSyncedUntil: Date | null = existing?.syncedUntil ?? null;
    if (params.syncedUntil) {
      if (!newSyncedUntil || params.syncedUntil.getTime() > newSyncedUntil.getTime()) {
        newSyncedUntil = params.syncedUntil;
      }
    }

    const data = {
      companyId: params.companyId,
      shiftId: params.shiftId,
      lastContactAt: params.contactAt,
      lastPendingCount: params.pendingCount,
      syncedUntil: newSyncedUntil,
      ...(params.isBatch ? { lastBatchAt: params.contactAt } : {}),
    };

    await this.prisma.systemPrisma.shiftSyncState.upsert({
      where: { shiftId: params.shiftId },
      create: {
        ...data,
        lastBatchAt: params.isBatch ? params.contactAt : null,
      },
      update: data,
    });
    await this.windowStates?.recalculate(params.shiftId);
    const shift = await this.prisma.systemPrisma.shift.findUnique({
      where: { id: params.shiftId },
      select: { siteId: true },
    });
    if (shift)
      this.realtime?.emitToSite(params.companyId, shift.siteId, 'turno.actualizado', {
        shiftId: params.shiftId,
        siteId: shift.siteId,
      });
  }

  async recordNotice(
    companyId: string,
    shiftId: string,
    input: ConnectionNoticeRequest,
  ): Promise<ConnectionNoticeResponse> {
    const receivedAt = this.clock.now();

    // systemPrisma se usa para registrar avisos de conexión conservando histórico
    this.logger.log({
      event: 'connection_notice.received',
      shiftId,
      pendingCount: input.pendingCount,
      syncedUntil: input.syncedUntil,
      sentAtDevice: input.sentAtDevice,
    });

    await this.prisma.systemPrisma.connectionNotice.create({
      data: {
        companyId,
        shiftId,
        sentAtDevice: new Date(input.sentAtDevice),
        receivedAt,
        pendingCount: input.pendingCount,
        syncedUntil: input.syncedUntil ? new Date(input.syncedUntil) : null,
      },
    });

    await this.updateSyncState({
      companyId,
      shiftId,
      pendingCount: input.pendingCount,
      syncedUntil: input.syncedUntil ? new Date(input.syncedUntil) : null,
      contactAt: receivedAt,
      isBatch: false,
    });

    return { receivedAt: receivedAt.toISOString() };
  }

  async getForShifts(shiftIds: string[]) {
    // systemPrisma se usa para exponer lectura de estados de sincronización de turnos
    return this.prisma.systemPrisma.shiftSyncState.findMany({
      where: { shiftId: { in: shiftIds } },
    });
  }

  async getForShift(shiftId: string) {
    // systemPrisma se usa para leer el estado de sincronización de un turno
    return this.prisma.systemPrisma.shiftSyncState.findUnique({
      where: { shiftId },
    });
  }
}

import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from './tenant-context';

@Injectable()
export class TenantResourceService {
  private readonly logger = new Logger(TenantResourceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: TenantContext,
  ) {}

  async findOwnedOrThrow(id: string, model: 'User' = 'User') {
    const user = this.context.user;
    if (!user) throw new ForbiddenException('La búsqueda requiere un contexto autenticado');

    const owned = await this.prisma.tenantPrisma.user.findFirst({ where: { id } });
    if (owned) return owned;

    const globalRecord = await this.prisma.systemPrisma.user.findUnique({
      where: { id },
      select: { companyId: true },
    });
    if (globalRecord && globalRecord.companyId !== user.companyId) {
      this.logger.error({
        userId: user.userId,
        companyId: user.companyId,
        targetCompanyId: globalRecord.companyId,
        resourceId: id,
        model,
        endpoint: `${this.context.current?.method ?? 'unknown'} ${this.context.current?.path ?? 'unknown'}`,
        correlationId: this.context.current?.correlationId,
        reason: 'intento de acceso a recurso de otra empresa',
      });
    }
    throw new NotFoundException('Recurso no encontrado');
  }
}

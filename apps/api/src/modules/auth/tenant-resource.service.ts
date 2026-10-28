import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { COMPANY_ID_MODELS, indirectTenantConfig, TENANT_MODELS } from '../prisma/tenant-prisma';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from './tenant-context';

interface TenantDelegate {
  findFirst(args: unknown): Promise<unknown>;
  findUnique(args: unknown): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tenantDelegate(client: object, name: string): TenantDelegate {
  const delegate = (client as unknown as Record<string, unknown>)[name];
  if (
    !isRecord(delegate) ||
    typeof delegate.findFirst !== 'function' ||
    typeof delegate.findUnique !== 'function'
  ) {
    throw new ForbiddenException(`Modelo tenant no registrado: ${name}`);
  }
  return delegate as unknown as TenantDelegate;
}

@Injectable()
export class TenantResourceService {
  private readonly logger = new Logger(TenantResourceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: TenantContext,
  ) {}

  async findOwnedOrThrow(model: string, id: string): Promise<Record<string, unknown>> {
    const user = this.context.user;
    if (!user) throw new ForbiddenException('La búsqueda requiere un contexto autenticado');
    if (!(TENANT_MODELS as readonly string[]).includes(model))
      throw new ForbiddenException(`Modelo tenant no registrado: ${model}`);

    const delegateName = `${model[0]?.toLowerCase() ?? ''}${model.slice(1)}`;
    const tenant = tenantDelegate(this.prisma.tenantPrisma, delegateName);
    const system = tenantDelegate(this.prisma.systemPrisma, delegateName);
    const owned = await tenant.findFirst({ where: { id } });
    if (isRecord(owned)) return owned;

    const direct = (COMPANY_ID_MODELS as readonly string[]).includes(model);
    const indirect = indirectTenantConfig(model);
    const select = direct
      ? { companyId: true }
      : indirect
        ? { [indirect.relation]: { select: { companyId: true } } }
        : {};
    const globalRecord = await system.findUnique({ where: { id }, select });
    const row = isRecord(globalRecord) ? globalRecord : undefined;
    const relationValue = indirect && row ? row[indirect.relation] : undefined;
    const relation: Record<string, unknown> | undefined = isRecord(relationValue)
      ? relationValue
      : undefined;
    const targetCompanyId =
      direct && row && typeof row.companyId === 'string'
        ? row.companyId
        : relation && typeof relation.companyId === 'string'
          ? relation.companyId
          : undefined;

    if (targetCompanyId && targetCompanyId !== user.companyId) {
      this.logger.error({
        userId: user.userId,
        companyId: user.companyId,
        targetCompanyId,
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

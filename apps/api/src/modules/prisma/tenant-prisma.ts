import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '../../generated/prisma/client';
import type { TenantContext } from '../auth/tenant-context';

/** Register every Prisma model that owns rows through a direct companyId field. */
/** Models whose rows are tenant-owned directly or through a User relation. */
export const TENANT_MODELS = ['User', 'Invitation'] as const;
/** Direct companyId fields are checked against the Prisma schema in tenant-prisma.spec.ts. */
export const COMPANY_ID_MODELS = ['User'] as const;
const COMPANY_ROOT_MODELS = ['Company'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addTenantFilter(model: string, args: unknown, companyId: string): unknown {
  if (!isRecord(args)) return args;
  const where = isRecord(args.where) ? args.where : {};
  if (COMPANY_ROOT_MODELS.some((companyModel) => companyModel === model)) {
    return { ...args, where: { ...where, id: companyId } };
  }
  if (model === 'User') return { ...args, where: { ...where, companyId } };
  const user = isRecord(where.user) ? where.user : {};
  return { ...args, where: { ...where, user: { ...user, companyId } } };
}

function setTenantOnData(model: string, data: unknown, companyId: string): unknown {
  if (model === 'Invitation') return data;
  if (Array.isArray(data))
    return data.map((item: unknown) => setTenantOnData(model, item, companyId));
  if (!isRecord(data)) return data;
  if (model === 'User') return { ...data, companyId };
  if (COMPANY_ROOT_MODELS.some((companyModel) => companyModel === model)) {
    return { ...data, id: companyId };
  }
  return data;
}

function addTenantToCreate(model: string, args: unknown, companyId: string): unknown {
  if (!isRecord(args)) return args;
  return { ...args, data: setTenantOnData(model, args.data, companyId) };
}

function addTenantToUpsert(model: string, args: unknown, companyId: string): unknown {
  if (!isRecord(args)) return args;
  const update = setTenantOnData(model, args.update, companyId);
  const create = setTenantOnData(model, args.create, companyId);
  return { ...(addTenantFilter(model, args, companyId) as object), update, create };
}

function scopeArgs(model: string, operation: string, args: unknown, companyId: string): unknown {
  if (operation === 'create' || operation === 'createMany' || operation === 'createManyAndReturn') {
    if (COMPANY_ROOT_MODELS.some((companyModel) => companyModel === model)) {
      throw new ForbiddenException('Las empresas solo se crean con systemPrisma');
    }
    return addTenantToCreate(model, args, companyId);
  }
  if (operation === 'upsert') {
    if (COMPANY_ROOT_MODELS.some((companyModel) => companyModel === model)) {
      throw new ForbiddenException('Las empresas solo se administran con systemPrisma');
    }
    return addTenantToUpsert(model, args, companyId);
  }
  if (operation === 'update' || operation === 'updateMany' || operation === 'updateManyAndReturn') {
    return addTenantToCreate(model, addTenantFilter(model, args, companyId), companyId);
  }
  if (operation === 'delete' || operation === 'deleteMany')
    return addTenantFilter(model, args, companyId);
  if (
    operation === 'findUnique' ||
    operation === 'findUniqueOrThrow' ||
    operation === 'findFirst' ||
    operation === 'findFirstOrThrow' ||
    operation === 'findMany' ||
    operation === 'count' ||
    operation === 'aggregate' ||
    operation === 'groupBy'
  )
    return addTenantFilter(model, args, companyId);
  return args;
}

async function validateInvitationOwnership(
  systemPrisma: PrismaClient,
  operation: string,
  args: unknown,
  companyId: string,
): Promise<void> {
  if (
    ![
      'create',
      'createMany',
      'createManyAndReturn',
      'upsert',
      'update',
      'updateMany',
      'updateManyAndReturn',
    ].includes(operation)
  )
    return;
  if (!isRecord(args)) return;
  const writes = operation === 'upsert' ? [args.create, args.update] : [args.data];
  const userIds = writes.flatMap((write) => {
    const records = Array.isArray(write) ? write : [write];
    return records.flatMap((record) => {
      if (!isRecord(record)) return [];
      if (typeof record.userId === 'string') return [record.userId];
      const relation = isRecord(record.user) ? record.user : undefined;
      const connect = relation && isRecord(relation.connect) ? relation.connect : undefined;
      if (connect && typeof connect.id === 'string') return [connect.id];
      throw new NotFoundException('Recurso no encontrado');
    });
  });
  if (userIds.length === 0) return;
  const allowed = await systemPrisma.user.findMany({
    where: { id: { in: userIds }, companyId },
    select: { id: true },
  });
  if (allowed.length !== new Set(userIds).size)
    throw new NotFoundException('Recurso no encontrado');
}

export function createTenantPrismaClient(systemPrisma: PrismaClient, context: TenantContext) {
  return systemPrisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const tenantModel = TENANT_MODELS.some((name) => name === model);
          const companyRootModel = COMPANY_ROOT_MODELS.some((name) => name === model);
          if (!tenantModel && !companyRootModel) return query(args);
          const user = context.user;
          if (!user)
            throw new ForbiddenException('La consulta requiere un contexto de empresa autenticado');
          if (model === 'Invitation')
            await validateInvitationOwnership(systemPrisma, operation, args, user.companyId);
          return query(scopeArgs(model, operation, args, user.companyId) as typeof args);
        },
      },
    },
  });
}

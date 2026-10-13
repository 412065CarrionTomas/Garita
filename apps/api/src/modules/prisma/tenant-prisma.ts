import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '../../generated/prisma/client';
import type { TenantContext } from '../auth/tenant-context';

/** Register every Prisma model that owns rows through a direct companyId field. */
/** Models whose rows are tenant-owned directly or through a User relation. */
/** Direct companyId fields are checked against the Prisma schema in tenant-prisma.spec.ts. */
export const COMPANY_ID_MODELS = [
  'User',
  'Client',
  'Site',
  'SiteSupervisor',
  'Checkpoint',
  'Round',
  'RoundVersionCheckpoint',
] as const;
/** Models without companyId declare the relation used to derive their tenant. */
export const INDIRECT_TENANT_MODELS = {
  Invitation: { relation: 'user', foreignKey: 'userId', relatedModel: 'User' },
  RoundVersion: { relation: 'round', foreignKey: 'roundId', relatedModel: 'Round' },
} as const;
export const TENANT_MODELS = [
  ...COMPANY_ID_MODELS,
  ...Object.keys(INDIRECT_TENANT_MODELS),
] as const;
const COMPANY_ROOT_MODELS = ['Company'] as const;

function isCompanyIdModel(model: string): model is (typeof COMPANY_ID_MODELS)[number] {
  return (COMPANY_ID_MODELS as readonly string[]).includes(model);
}

export function indirectTenantConfig(
  model: string,
): (typeof INDIRECT_TENANT_MODELS)[keyof typeof INDIRECT_TENANT_MODELS] | undefined {
  return Object.hasOwn(INDIRECT_TENANT_MODELS, model)
    ? INDIRECT_TENANT_MODELS[model as keyof typeof INDIRECT_TENANT_MODELS]
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addTenantFilter(model: string, args: unknown, companyId: string): unknown {
  if (!isRecord(args)) return args;
  const where = isRecord(args.where) ? args.where : {};
  if (COMPANY_ROOT_MODELS.some((companyModel) => companyModel === model)) {
    return { ...args, where: { ...where, id: companyId } };
  }
  if (isCompanyIdModel(model)) return { ...args, where: { ...where, companyId } };
  const config = indirectTenantConfig(model);
  if (!config) throw new ForbiddenException(`Modelo tenant sin estrategia: ${model}`);
  const relationValue = where[config.relation];
  const relation = isRecord(relationValue) ? relationValue : {};
  return { ...args, where: { ...where, [config.relation]: { ...relation, companyId } } };
}

export function addSiteAssignmentFilter(
  model: string,
  args: unknown,
  user: TenantContext['user'],
): unknown {
  if (!isRecord(args) || user?.role !== 'supervisor') return args;
  const where = isRecord(args.where) ? args.where : {};
  const assignment = { supervisors: { some: { userId: user.userId } } };
  if (model === 'Site') return { ...args, where: { ...where, ...assignment } };
  if (model === 'SiteSupervisor') return { ...args, where: { ...where, userId: user.userId } };
  if (model === 'Checkpoint') return { ...args, where: { AND: [where, { site: assignment }] } };
  if (model === 'Round') return { ...args, where: { AND: [where, { site: assignment }] } };
  if (model === 'RoundVersion')
    return { ...args, where: { AND: [where, { round: { site: assignment } }] } };
  if (model === 'RoundVersionCheckpoint')
    return { ...args, where: { AND: [where, { roundVersion: { round: { site: assignment } } }] } };
  if (model === 'Client') {
    const siteFilter = { supervisors: { some: { userId: user.userId } } };
    const constrainSites = (selection: unknown): unknown => {
      if (selection === true) return { where: siteFilter };
      if (!isRecord(selection)) return selection;
      const nestedWhere = isRecord(selection.where) ? selection.where : {};
      return { ...selection, where: { AND: [nestedWhere, siteFilter] } };
    };
    const constrainSelection = (selection: unknown): unknown => {
      if (!isRecord(selection) || !Object.hasOwn(selection, 'sites')) return selection;
      return { ...selection, sites: constrainSites(selection.sites) };
    };
    const existingSites = isRecord(where.sites) ? where.sites : {};
    return {
      ...args,
      where: {
        ...where,
        sites: { ...existingSites, some: { AND: [existingSites.some ?? {}, siteFilter] } },
      },
      ...(args.include ? { include: constrainSelection(args.include) } : {}),
      ...(args.select ? { select: constrainSelection(args.select) } : {}),
    };
  }
  return args;
}

function setTenantOnData(model: string, data: unknown, companyId: string): unknown {
  if (Array.isArray(data))
    return data.map((item: unknown) => setTenantOnData(model, item, companyId));
  if (!isRecord(data)) return data;
  if (isCompanyIdModel(model)) return { ...data, companyId };
  if (indirectTenantConfig(model)) return data;
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

export function scopeArgs(
  model: string,
  operation: string,
  args: unknown,
  companyId: string,
): unknown {
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
  throw new ForbiddenException(`Operación ${operation} no soportada para modelo tenant ${model}`);
}

async function validateIndirectOwnership(
  systemPrisma: PrismaClient,
  config: (typeof INDIRECT_TENANT_MODELS)[keyof typeof INDIRECT_TENANT_MODELS],
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
  const updateOperation = ['update', 'updateMany', 'updateManyAndReturn'].includes(operation);
  const writes = operation === 'upsert' ? [args.create, args.update] : [args.data];
  const userIds = writes.flatMap((write, writeIndex) => {
    if (updateOperation || (operation === 'upsert' && writeIndex === 1)) {
      const records = Array.isArray(write) ? write : [write];
      const changesRelation = records.some(
        (record) =>
          isRecord(record) &&
          (Object.hasOwn(record, config.foreignKey) || Object.hasOwn(record, config.relation)),
      );
      if (!changesRelation) return [];
    }
    const records = Array.isArray(write) ? write : [write];
    return records.flatMap((record) => {
      if (!isRecord(record)) return [];
      const foreignKey = record[config.foreignKey];
      if (typeof foreignKey === 'string') return [foreignKey];
      const relationValue = record[config.relation];
      const relation = isRecord(relationValue) ? relationValue : undefined;
      const connect = relation && isRecord(relation.connect) ? relation.connect : undefined;
      if (connect && typeof connect.id === 'string') return [connect.id];
      throw new NotFoundException('Recurso no encontrado');
    });
  });
  if (userIds.length === 0) return;
  const delegateName = `${config.relatedModel[0]?.toLowerCase() ?? ''}${config.relatedModel.slice(1)}`;
  const delegate = (systemPrisma as unknown as Record<string, unknown>)[delegateName];
  if (!isRecord(delegate) || typeof delegate.findMany !== 'function') {
    throw new ForbiddenException(
      `Modelo relacionado no disponible para tenant: ${config.relatedModel}`,
    );
  }
  const findMany = delegate.findMany as (query: unknown) => Promise<unknown[]>;
  const allowed = await findMany.call(delegate, {
    where: { id: { in: userIds }, companyId },
    select: { id: true },
  });
  if (allowed.length !== new Set(userIds).size)
    throw new NotFoundException('Recurso no encontrado');
}

export function createTenantPrismaClient(systemPrisma: PrismaClient, context: TenantContext) {
  const extended = systemPrisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const tenantModel = TENANT_MODELS.some((name) => name === model);
          const companyRootModel = COMPANY_ROOT_MODELS.some((name) => name === model);
          if (!tenantModel && !companyRootModel) return query(args);
          const user = context.user;
          if (!user)
            throw new ForbiddenException('La consulta requiere un contexto de empresa autenticado');
          const indirect = indirectTenantConfig(model);
          if (indirect)
            await validateIndirectOwnership(
              systemPrisma,
              indirect,
              operation,
              args,
              user.companyId,
            );
          const tenantArgs = scopeArgs(model, operation, args, user.companyId);
          return query(addSiteAssignmentFilter(model, tenantArgs, user) as typeof args);
        },
      },
    },
  });
  return blockRawSql(extended);
}

const RAW_SQL_METHODS = ['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe'];

/** Bloquea SQL crudo también dentro de las transacciones interactivas. */
function blockRawSql<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (typeof property === 'string' && RAW_SQL_METHODS.includes(property)) {
        return () => {
          throw new ForbiddenException('SQL crudo solo está disponible mediante systemPrisma');
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      if (property === '$transaction' && typeof value === 'function') {
        return (arg: unknown, ...rest: unknown[]) =>
          (value as (...args: unknown[]) => unknown).call(
            target,
            typeof arg === 'function'
              ? (tx: object) => (arg as (tx: object) => unknown)(blockRawSql(tx))
              : arg,
            ...rest,
          );
      }
      return value;
    },
  });
}

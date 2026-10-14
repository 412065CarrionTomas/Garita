import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PrismaClient } from '../../generated/prisma/client';
import {
  COMPANY_ID_MODELS,
  addSiteAssignmentFilter,
  createTenantPrismaClient,
  INDIRECT_TENANT_MODELS,
  scopeArgs,
  TENANT_MODELS,
} from './tenant-prisma';

describe('registro del aislamiento tenant', () => {
  it('cubre todos los modelos del schema Prisma con un campo companyId', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const schemaTenantModels = [...schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\}/g)]
      .filter((match) => /^\s*companyId\s+/m.test(match[2] ?? ''))
      .map((match) => match[1])
      .sort();

    expect([...COMPANY_ID_MODELS].sort()).toEqual(schemaTenantModels);
    expect(TENANT_MODELS).toEqual(expect.arrayContaining(COMPANY_ID_MODELS));
    const indirectModels = TENANT_MODELS.filter(
      (model) => !(COMPANY_ID_MODELS as readonly string[]).includes(model),
    );
    expect([...indirectModels].sort()).toEqual(Object.keys(INDIRECT_TENANT_MODELS).sort());
    expect(schemaTenantModels).not.toContain('Company');
  });

  it('agrega filtros directos sin acoplar la lógica al nombre del modelo', () => {
    expect(scopeArgs('User', 'findMany', { where: { role: 'guard' } }, 'norte-company')).toEqual({
      where: { role: 'guard', companyId: 'norte-company' },
    });
  });

  it('registra puntos y limita las lecturas del supervisor a predios asignados', () => {
    expect(COMPANY_ID_MODELS).toContain('Checkpoint');
    expect(scopeArgs('Checkpoint', 'findMany', { where: { status: 'active' } }, 'norte')).toEqual({
      where: { status: 'active', companyId: 'norte' },
    });
  });

  it('registra etiquetas NFC y las limita por el predio de su punto', () => {
    expect(COMPANY_ID_MODELS).toContain('NfcTag');
    expect(scopeArgs('NfcTag', 'findMany', { where: { status: 'active' } }, 'norte')).toEqual({
      where: { status: 'active', companyId: 'norte' },
    });
    expect(
      addSiteAssignmentFilter(
        'NfcTag',
        { where: { status: 'active' } },
        {
          userId: 'supervisor-1',
          companyId: 'norte',
          role: 'supervisor',
          status: 'active',
        },
      ),
    ).toEqual({
      where: {
        AND: [
          { status: 'active' },
          { checkpoint: { site: { supervisors: { some: { userId: 'supervisor-1' } } } } },
        ],
      },
    });
  });

  it('registra rondas y filtra sus lecturas por predios asignados', () => {
    expect(COMPANY_ID_MODELS).toContain('Round');
    expect(
      addSiteAssignmentFilter(
        'Round',
        { where: { status: 'active' } },
        { userId: 'supervisor-1', companyId: 'norte', role: 'supervisor', status: 'active' },
      ),
    ).toEqual({
      where: {
        AND: [
          { status: 'active' },
          { site: { supervisors: { some: { userId: 'supervisor-1' } } } },
        ],
      },
    });
    expect(INDIRECT_TENANT_MODELS).toHaveProperty('RoundVersion');
  });

  it('registra turnos y limita turnos y relaciones a los predios del supervisor', () => {
    expect(COMPANY_ID_MODELS).toContain('Shift');
    expect(INDIRECT_TENANT_MODELS).toHaveProperty('ShiftAssignment');
    expect(INDIRECT_TENANT_MODELS).toHaveProperty('ShiftRound');
    expect(COMPANY_ID_MODELS).toContain('ShiftEvent');
    expect(COMPANY_ID_MODELS).toContain('CheckpointRecord');
    expect(COMPANY_ID_MODELS).toContain('InvalidScanAttempt');
    const user = {
      userId: 'supervisor-1',
      companyId: 'norte',
      role: 'supervisor' as const,
      status: 'active' as const,
    };
    expect(addSiteAssignmentFilter('Shift', { where: { status: 'scheduled' } }, user)).toEqual({
      where: {
        AND: [
          { status: 'scheduled' },
          { site: { supervisors: { some: { userId: 'supervisor-1' } } } },
        ],
      },
    });
    expect(addSiteAssignmentFilter('ShiftAssignment', { where: {} }, user)).toEqual({
      where: {
        AND: [
          {},
          {
            shift: {
              site: { supervisors: { some: { userId: 'supervisor-1' } } },
            },
          },
        ],
      },
    });
    expect(addSiteAssignmentFilter('ShiftEvent', { where: { type: 'start' } }, user)).toEqual({
      where: {
        AND: [
          { type: 'start' },
          { shift: { site: { supervisors: { some: { userId: 'supervisor-1' } } } } },
        ],
      },
    });
    expect(addSiteAssignmentFilter('CheckpointRecord', { where: { method: 'qr' } }, user)).toEqual({
      where: {
        AND: [
          { method: 'qr' },
          { shift: { site: { supervisors: { some: { userId: 'supervisor-1' } } } } },
        ],
      },
    });
    expect(
      addSiteAssignmentFilter('InvalidScanAttempt', { where: { method: 'qr' } }, user),
    ).toEqual({
      where: {
        AND: [
          { method: 'qr' },
          { shift: { site: { supervisors: { some: { userId: 'supervisor-1' } } } } },
        ],
      },
    });
    expect(COMPANY_ID_MODELS).toContain('ShiftCredential');
    expect(COMPANY_ID_MODELS).toContain('SyncBatch');
    expect(COMPANY_ID_MODELS).toContain('ConnectionNotice');
    expect(COMPANY_ID_MODELS).toContain('ShiftSyncState');
    expect(addSiteAssignmentFilter('ShiftCredential', { where: { shiftId: 's-1' } }, user)).toEqual(
      {
        where: {
          AND: [
            { shiftId: 's-1' },
            { shift: { site: { supervisors: { some: { userId: 'supervisor-1' } } } } },
          ],
        },
      },
    );
    expect(addSiteAssignmentFilter('SyncBatch', { where: { shiftId: 's-1' } }, user)).toEqual({
      where: {
        AND: [
          { shiftId: 's-1' },
          { shift: { site: { supervisors: { some: { userId: 'supervisor-1' } } } } },
        ],
      },
    });
    expect(
      addSiteAssignmentFilter('ConnectionNotice', { where: { shiftId: 's-1' } }, user),
    ).toEqual({
      where: {
        AND: [
          { shiftId: 's-1' },
          { shift: { site: { supervisors: { some: { userId: 'supervisor-1' } } } } },
        ],
      },
    });
    expect(addSiteAssignmentFilter('ShiftSyncState', { where: { shiftId: 's-1' } }, user)).toEqual({
      where: {
        AND: [
          { shiftId: 's-1' },
          { shift: { site: { supervisors: { some: { userId: 'supervisor-1' } } } } },
        ],
      },
    });
  });

  it('falla cerrado ante operaciones tenant no soportadas', () => {
    expect(() => scopeArgs('User', 'futureOperation', {}, 'norte-company')).toThrow(
      'Operación futureOperation no soportada',
    );
  });
});

describe('bloqueo de SQL crudo', () => {
  it('también aplica dentro de una transacción interactiva', () => {
    const tx = { $queryRawUnsafe: jest.fn(), $executeRaw: jest.fn() };
    const extended = {
      $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
      $queryRaw: jest.fn(),
    };
    const system = { $extends: () => extended } as unknown as PrismaClient;
    const client = createTenantPrismaClient(system, { user: undefined } as never) as unknown as {
      $queryRaw: () => void;
      $transaction: (callback: (client: typeof tx) => unknown) => unknown;
    };
    expect(() => {
      client.$queryRaw();
    }).toThrow('SQL crudo');
    expect(() =>
      client.$transaction((inner) => {
        inner.$queryRawUnsafe();
      }),
    ).toThrow('SQL crudo');
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});

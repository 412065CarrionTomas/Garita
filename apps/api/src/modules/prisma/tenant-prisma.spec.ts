import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  COMPANY_ID_MODELS,
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

  it('falla cerrado ante operaciones tenant no soportadas', () => {
    expect(() => scopeArgs('User', 'futureOperation', {}, 'norte-company')).toThrow(
      'Operación futureOperation no soportada',
    );
  });
});

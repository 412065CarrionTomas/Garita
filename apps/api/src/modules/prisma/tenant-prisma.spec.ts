import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMPANY_ID_MODELS, TENANT_MODELS } from './tenant-prisma';

describe('registro del aislamiento tenant', () => {
  it('cubre todos los modelos del schema Prisma con un campo companyId', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const schemaTenantModels = [...schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\}/g)]
      .filter((match) => /^\s*companyId\s+/m.test(match[2] ?? ''))
      .map((match) => match[1])
      .sort();

    expect([...COMPANY_ID_MODELS].sort()).toEqual(schemaTenantModels);
    expect(TENANT_MODELS).toContain('User');
    expect(TENANT_MODELS).toContain('Invitation');
    expect(schemaTenantModels).not.toContain('Company');
  });
});

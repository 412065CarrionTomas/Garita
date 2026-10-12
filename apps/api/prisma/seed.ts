import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

try {
  process.loadEnvFile('.env');
} catch {
  /* CI proporciona las variables del entorno. */
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL es obligatoria para cargar el seed');
const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });
const roles = ['admin', 'supervisor', 'guard', 'client'] as const;

async function seedCompany(name: string, prefix: string): Promise<string> {
  const company = await prisma.company.upsert({
    where: { id: `${prefix}-company` },
    create: { id: `${prefix}-company`, name },
    update: { name },
  });
  for (const role of roles) {
    await prisma.user.upsert({
      where: { firebaseUid: `seed-${prefix}-${role}` },
      create: {
        companyId: company.id,
        firebaseUid: `seed-${prefix}-${role}`,
        email: `${prefix}-${role}@seed.garita.invalid`,
        firstName: role,
        lastName: 'Seed',
        role,
        status: 'active',
      },
      update: { companyId: company.id, role, status: 'active' },
    });
  }
  return company.id;
}

async function main(): Promise<void> {
  const north = await seedCompany('Seguridad Norte', 'norte');
  await seedCompany('Custodia Sur', 'sur');
  for (const [uid, status] of [
    ['seed-norte-deactivated', 'deactivated'],
    ['seed-norte-pending', 'invitation_pending'],
  ] as const) {
    await prisma.user.upsert({
      where: { firebaseUid: uid },
      create: {
        companyId: north,
        firebaseUid: uid,
        email: `${uid}@seed.garita.invalid`,
        firstName: uid,
        lastName: 'Seed',
        role: 'guard',
        status,
      },
      update: { companyId: north, status },
    });
  }
}

void main()
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Error desconocido al cargar el seed'}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* CI proporciona las variables del entorno. */
  }
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
  const south = await seedCompany('Custodia Sur', 'sur');
  for (const [companyId, prefix] of [
    [north, 'norte'],
    [south, 'sur'],
  ] as const) {
    const client = await prisma.client.upsert({
      where: { companyId_name: { companyId, name: `Cliente ${prefix}` } },
      create: {
        companyId,
        name: `Cliente ${prefix}`,
        contactName: 'Contacto Seed',
        phone: '+541100000000',
        email: `${prefix}-contacto@seed.garita.invalid`,
      },
      update: {},
    });
    for (const [index, name] of ['Predio A', 'Predio B'].entries()) {
      const site = await prisma.site.upsert({
        where: { clientId_name: { clientId: client.id, name } },
        create: {
          companyId,
          clientId: client.id,
          name,
          address: `Dirección ${index + 1}`,
          latitude: -34.6 + index * 0.01,
          longitude: -58.4 + index * 0.01,
        },
        update: {},
      });
      if (prefix === 'norte') {
        for (const [checkpointIndex, checkpointName] of [
          'Portón principal',
          'Depósito central',
          'Acceso perimetral',
        ].entries()) {
          await prisma.checkpoint.upsert({
            where: { siteId_name: { siteId: site.id, name: checkpointName } },
            create: {
              companyId,
              siteId: site.id,
              name: checkpointName,
              latitude: -34.6 + index * 0.01 + checkpointIndex * 0.0001,
              longitude: -58.4 + index * 0.01 + checkpointIndex * 0.0001,
              isIndoor: checkpointIndex === 1,
            },
            update: {},
          });
        }
      }
    }
  }
  const northClient = await prisma.client.findUniqueOrThrow({
    where: { companyId_name: { companyId: north, name: 'Cliente norte' } },
  });
  const northSite = await prisma.site.findUniqueOrThrow({
    where: { clientId_name: { clientId: northClient.id, name: 'Predio A' } },
  });
  const northSupervisor = await prisma.user.findUniqueOrThrow({
    where: { firebaseUid: 'seed-norte-supervisor' },
  });
  await prisma.siteSupervisor.upsert({
    where: { siteId_userId: { siteId: northSite.id, userId: northSupervisor.id } },
    create: { companyId: north, siteId: northSite.id, userId: northSupervisor.id },
    update: {},
  });
  const checkpoints = await prisma.checkpoint.findMany({
    where: { companyId: north, siteId: northSite.id, status: 'active' },
    orderBy: { name: 'asc' },
  });
  const seedRound = async (name: string, frequencyMinutes: number, checkpointIds: string[]) => {
    const round = await prisma.round.upsert({
      where: { siteId_name: { siteId: northSite.id, name } },
      create: { companyId: north, siteId: northSite.id, name },
      update: { status: 'active' },
    });
    const version = await prisma.roundVersion.upsert({
      where: { roundId_versionNumber: { roundId: round.id, versionNumber: 1 } },
      create: {
        roundId: round.id,
        versionNumber: 1,
        frequencyMinutes,
        windowStartLocal: '22:00',
        windowEndLocal: '06:00',
        graceMinutes: frequencyMinutes === 120 ? 15 : 15,
        createdById: northSupervisor.id,
      },
      update: {},
    });
    for (const [position, checkpointId] of checkpointIds.entries()) {
      await prisma.roundVersionCheckpoint.upsert({
        where: { roundVersionId_checkpointId: { roundVersionId: version.id, checkpointId } },
        create: { companyId: north, roundVersionId: version.id, checkpointId, position },
        update: { position },
      });
    }
    await prisma.round.update({ where: { id: round.id }, data: { currentVersionId: version.id } });
  };
  await seedRound(
    'Perimetral',
    120,
    checkpoints.map(({ id }) => id),
  );
  await seedRound(
    'Interna',
    60,
    checkpoints.slice(0, 2).map(({ id }) => id),
  );
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
  const perimetral = await prisma.round.findUniqueOrThrow({
    where: { siteId_name: { siteId: northSite.id, name: 'Perimetral' } },
  });
  const activeGuard = await prisma.user.findUniqueOrThrow({
    where: { firebaseUid: 'seed-norte-guard' },
  });
  const pendingGuard = await prisma.user.findUniqueOrThrow({
    where: { firebaseUid: 'seed-norte-pending' },
  });
  const seededShifts = [
    {
      startsAt: new Date('2030-10-14T23:00:00.000Z'),
      endsAt: new Date('2030-10-15T11:00:00.000Z'),
      guardId: activeGuard.id,
    },
    {
      startsAt: new Date('2030-10-15T23:00:00.000Z'),
      endsAt: new Date('2030-10-16T11:00:00.000Z'),
      guardId: pendingGuard.id,
    },
  ];
  for (const value of seededShifts) {
    const existing = await prisma.shift.findFirst({
      where: { siteId: northSite.id, startsAt: value.startsAt },
    });
    if (existing) continue;
    await prisma.shift.create({
      data: {
        companyId: north,
        siteId: northSite.id,
        startsAt: value.startsAt,
        endsAt: value.endsAt,
        serviceDate: new Date(`${value.startsAt.toISOString().slice(0, 10)}T00:00:00.000Z`),
        createdById: northSupervisor.id,
        assignments: {
          create: {
            guardId: value.guardId,
            startsAt: value.startsAt,
            endsAt: value.endsAt,
            assignedById: northSupervisor.id,
          },
        },
        rounds: { create: { roundId: perimetral.id } },
      },
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

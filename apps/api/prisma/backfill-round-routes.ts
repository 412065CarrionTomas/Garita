/**
 * Calcula por calles el recorrido de las rondas activas que todavía no tienen (route = null).
 * Lo guarda en su versión actual sin crear versiones nuevas: solo agrega el dibujo y no cambia
 * reglas. Es idempotente: una segunda pasada no toca las que ya tienen recorrido. Si el servicio
 * falla por algo pasajero (límite, caída), la ronda no se toca y la próxima pasada la reintenta.
 *
 * Uso: pnpm --filter api db:backfill-routes
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { defaultRouteInput, type LngLat, type RouteFailureReason } from '@garita/shared';
import { Prisma, PrismaClient } from '../src/generated/prisma/client';
import { RouteBuilder } from '../src/modules/routing/route-builder';
import { OpenRouteServiceRouting } from '../src/modules/routing/routing.port';

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* CI proporciona las variables del entorno. */
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL es obligatoria para el backfill');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

const apiKey = process.env.ORS_API_KEY;
// Sin clave todo quedaría recto y, como ya no sería null, una pasada posterior no lo recalcularía.
if (!apiKey) throw new Error('ORS_API_KEY es obligatoria: sin clave el recorrido quedaría recto');
const builder = new RouteBuilder(
  new OpenRouteServiceRouting(
    apiKey,
    process.env.ORS_URL ?? 'https://api.heigit.org/openrouteservice',
    // Sin caché: cada ronda se pide una sola vez.
    { get: () => Promise.resolve(null), set: () => Promise.resolve() },
  ),
);
// openrouteservice admite 40 pedidos por minuto: una ronda por calles suele ser un solo pedido.
const PAUSE_MS = 1600;
/** Al llegar al límite por minuto se espera a que se renueve antes de seguir. */
const RATE_LIMIT_PAUSE_MS = 60_000;
/** Fallas que no dependen de la ronda: guardarla recta impediría recalcularla después. */
// 'skipped' no entra: solo acompaña a una falla de un punto (sin calle), que no se arregla sola.
const TRANSIENT = new Set<RouteFailureReason>(['rate_limited', 'unavailable']);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const rounds = await prisma.round.findMany({
    where: { status: 'active', currentVersion: { route: { equals: Prisma.DbNull } } },
    select: {
      id: true,
      name: true,
      site: { select: { maxSpeedProfile: true } },
      currentVersion: {
        select: {
          id: true,
          checkpoints: {
            orderBy: { position: 'asc' },
            select: { checkpoint: { select: { latitude: true, longitude: true } } },
          },
        },
      },
    },
  });
  let streets = 0;
  let straight = 0;
  let retry = 0;
  for (const round of rounds) {
    const version = round.currentVersion;
    if (!version) continue;
    const points = version.checkpoints.map(({ checkpoint }): LngLat => [
      Number(checkpoint.longitude),
      Number(checkpoint.latitude),
    ]);
    const { route, failures } = await builder.build(
      defaultRouteInput(points.length),
      points,
      round.site.maxSpeedProfile,
    );
    if (failures.some((failure) => TRANSIENT.has(failure.reason))) {
      retry++;
      process.stdout.write(`${round.name}: sin cambios, se reintenta en la próxima pasada\n`);
      const limited = failures.some((failure) => failure.reason === 'rate_limited');
      await sleep(limited ? RATE_LIMIT_PAUSE_MS : PAUSE_MS);
      continue;
    }
    await prisma.roundVersion.update({ where: { id: version.id }, data: { route } });
    if (failures.length > 0) straight++;
    else streets++;
    process.stdout.write(`${round.name}: ${failures.length > 0 ? 'recto' : 'por calles'}\n`);
    await sleep(PAUSE_MS);
  }
  process.stdout.write(
    `Rondas calculadas por calles: ${String(streets)}. Quedaron rectas: ${String(straight)}. ` +
      `Para reintentar: ${String(retry)}.\n`,
  );
}

void main()
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Error desconocido en el backfill'}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

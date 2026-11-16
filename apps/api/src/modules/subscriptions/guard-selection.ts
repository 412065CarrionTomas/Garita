import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { countsTowardGuardLimit, guardSelectionSchema, type GuardSelection } from '@garita/shared';
import { z } from 'zod';
import { TenantContext } from '../auth/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

export const storedGuardSelectionSchema = guardSelectionSchema.extend({
  adminId: z.string().min(1),
  pendingGuardIds: z.array(z.string().min(1)),
});

@Injectable()
export class GuardSelectionService {
  private readonly logger = new Logger(GuardSelectionService.name);
  constructor(
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
    private readonly context: TenantContext,
  ) {}

  async validate(maxGuards: number, selection: GuardSelection | undefined, adminId: string) {
    const guards: { id: string; firstName: string; lastName: string; status: string }[] = [];
    for (let pagina = 1; ; pagina++) {
      const page = await this.users.list({ rol: 'guard', pagina });
      guards.push(...page.items.filter((g) => countsTowardGuardLimit(g.status)));
      if (pagina >= page.paginas) break;
    }
    if (guards.length <= maxGuards && !selection) return null;
    const required = async () =>
      new ConflictException({
        code: 'guard_selection_required',
        maxGuards,
        guards: await Promise.all(
          guards.map(async (guard) => ({
            id: guard.id,
            name: `${guard.firstName} ${guard.lastName}`,
            futureShiftCount: await this.users.countFutureShifts(guard.id),
          })),
        ),
      });
    if (!selection) throw await required();
    const keep = new Set(selection.guardsToKeep);
    const counted = new Set(guards.map((g) => g.id));
    const excluded = guards.filter((g) => !keep.has(g.id));
    if (
      keep.size !== selection.guardsToKeep.length ||
      keep.size === 0 ||
      keep.size > maxGuards ||
      [...keep].some((id) => !counted.has(id)) ||
      selection.shiftDecisions.length !== excluded.length ||
      new Set(selection.shiftDecisions.map((d) => d.guardId)).size !== excluded.length
    )
      throw await required();
    for (const decision of selection.shiftDecisions) {
      if (
        !excluded.some((g) => g.id === decision.guardId) ||
        (decision.shiftAction === 'derive' && !keep.has(decision.deriveToUserId))
      )
        throw await required();
      if (
        decision.shiftAction === 'unassign' &&
        decision.confirmUnassignedCount !== (await this.users.countFutureShifts(decision.guardId))
      )
        throw await required();
    }
    return { ...selection, adminId, pendingGuardIds: excluded.map((g) => g.id) };
  }

  async apply(subscriptionId: string, companyId: string, raw: unknown) {
    if (raw === null || raw === undefined) return null;
    // The selection stays stored as a record; once applied there is nothing to lock or read.
    const stored = storedGuardSelectionSchema.safeParse(raw);
    if (stored.success && stored.data.pendingGuardIds.length === 0) return null;
    // A subscription can be picked by a webhook and a sweep concurrently.
    return this.prisma.systemPrisma.$transaction(
      async (db) => {
        await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`guards-${subscriptionId}`}, 0))`;
        const fresh = await db.subscription.findUniqueOrThrow({
          where: { id: subscriptionId, companyId },
        });
        if (fresh.status !== 'authorized') return null;
        const selection = storedGuardSelectionSchema.parse(fresh.guardSelection);
        return this.context.run(
          {
            correlationId: `guard-selection-${subscriptionId}`,
            user: { userId: selection.adminId, companyId, role: 'admin', status: 'active' },
          },
          async () => {
            for (const guardId of [...selection.pendingGuardIds]) {
              const decision = selection.shiftDecisions.find((d) => d.guardId === guardId);
              if (!decision) throw new Error('Falta la decisión del vigilador pendiente');
              try {
                await this.users.deactivate(
                  guardId,
                  selection.adminId,
                  decision.shiftAction === 'derive'
                    ? { deriveToUserId: decision.deriveToUserId }
                    : {
                        leaveUnassigned: true,
                        confirmUnassignedCount: await this.users.countFutureShifts(guardId),
                      },
                );
                this.logger.log({
                  event: 'subscription.guard_deactivated',
                  subscriptionId,
                  companyId,
                  guardId,
                  shiftAction: decision.shiftAction,
                });
                selection.pendingGuardIds = selection.pendingGuardIds.filter(
                  (id) => id !== guardId,
                );
                // Background work has no HTTP request; scope every write to the owning subscription/company.
                await db.subscription.update({
                  where: { id: subscriptionId, companyId },
                  data: { guardSelection: selection },
                });
              } catch (error) {
                // deactivate() commits on its own connection: throwing here would roll back the
                // progress already saved. The guard stays pending and the next sweep retries it.
                if (!(
                  error instanceof ConflictException &&
                  z
                    .object({ code: z.literal('GUARD_HAS_SHIFT_IN_PROGRESS') })
                    .safeParse(error.getResponse()).success
                ))
                  this.logger.error({
                    event: 'subscription.guard_deactivation_failed',
                    subscriptionId,
                    companyId,
                    guardId,
                    error: error instanceof Error ? error.message : 'Error desconocido',
                  });
              }
            }
            return selection;
          },
        );
      },
      { timeout: 120_000 },
    );
  }
}

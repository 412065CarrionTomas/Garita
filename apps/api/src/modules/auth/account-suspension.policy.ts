import { HttpException } from '@nestjs/common';
import { computeSyncDeadline, siteConnectivitySchema, SUSPENSION_MESSAGES } from '@garita/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth.types';
import { z } from 'zod';

// Public routes return before this policy. ShiftCredentialGuard routes are public to AuthGuard:
// their scoped credential must keep accepting field work and late data during suspension.
export const SUSPENSION_ENDPOINTS = {
  'GET auth/me': 'always', // Session and recovery polling, for every existing role.
  'GET cuenta/estado': 'always', // Billing state remains admin only.
  'GET planes': 'always', // Plan selection remains admin only.
  'GET supervision/turnos': 'shift', // Only the started shifts still receiving data.
  'GET mis-turnos': 'shift', // Only the guard's started assignments.
  'GET turnos/:id': 'shift', // Existing role and site permissions still apply.
  'GET turnos/:id/detalle': 'shift', // Live supervision detail.
  'GET turnos/:id/estado': 'shift', // Live execution state.
  'GET turnos/:id/datos': 'shift', // Offline data for a started assignment.
  'POST turnos/:id/cerrar': 'shift', // A working guard must be able to close.
  'POST turnos/:id/cerrar-sin-datos': 'pending-sync', // Started, pending data, before deadline only.
  'GET avisos': 'notice', // Notices belonging to visible started shifts only.
  'GET avisos/:id': 'notice', // Same predicate as its list.
  'POST avisos/:id/marcar-visto': 'notice', // Reading a working shift's notice.
  'GET alertas-panico': 'panic', // Unresolved alerts survive the shift's sync deadline.
  'GET alertas-panico/:id': 'panic', // Only unresolved alerts of previously started shifts.
  'POST alertas-panico/:id/confirmar': 'panic', // Safety attention stays available.
  'POST alertas-panico/:id/resolver': 'panic', // Safety attention ends on resolution.
} as const;

export function suspensionClassification(method: string, path: string) {
  // These families retain their existing role checks; all new unrelated endpoints are blocked.
  if (path === 'suscripcion' || path.startsWith('suscripcion/')) return 'always';
  if (path === 'dispositivos' || path.startsWith('dispositivos/')) return 'always';
  const key = `${method} ${path}`;
  return Object.hasOwn(SUSPENSION_ENDPOINTS, key)
    ? SUSPENSION_ENDPOINTS[key as keyof typeof SUSPENSION_ENDPOINTS]
    : 'blocked';
}

export function suspendedVisibleShiftWhere(user?: AuthenticatedUser): Prisma.ShiftWhereInput {
  return user?.suspension ? { id: { in: user.suspension.shiftIds } } : {};
}

export function suspendedVisiblePanicWhere(user?: AuthenticatedUser): Prisma.PanicAlertWhereInput {
  return user?.suspension ? { id: { in: user.suspension.panicIds } } : {};
}

export function suspensionError(role: AuthenticatedUser['role']): HttpException {
  return new HttpException(
    {
      code: 'ACCOUNT_SUSPENDED',
      accountStatus: 'suspended',
      message: SUSPENSION_MESSAGES[role],
    },
    402,
  );
}

export async function enforceAccountSuspension(
  prisma: PrismaService,
  request: AuthenticatedRequest,
  user: AuthenticatedUser,
  company: { accountStatus: string; suspendedAt: Date | null },
  now: Date,
): Promise<void> {
  if (company.accountStatus !== 'suspended') return;
  const route = z.object({ path: z.string() }).safeParse(request.route as unknown);
  const path = (route.success ? route.data.path : '')
    .replace(/^\/api\/v1\//, '')
    .replace(/^\//, '');
  const classification = suspensionClassification(request.method, path);
  if (classification === 'always') return;
  if (classification === 'blocked') {
    if (request.method === 'POST' && path === 'turnos/:id/iniciar' && user.role === 'guard') {
      // The rejected start claims only this guard's unstarted shift, never a running assignment.
      await prisma.tenantPrisma.shift.updateMany({
        where: {
          id: String(request.params.id),
          startedAt: null,
          status: { in: ['scheduled', 'unassigned'] },
          assignments: { some: { guardId: user.userId, isCurrent: true, active: true } },
        },
        data: { status: 'cancelled_by_suspension' },
      });
    }
    throw suspensionError(user.role);
  }
  if (!company.suspendedAt || user.role === 'client') throw suspensionError(user.role);
  const db = prisma.tenantPrisma;
  const shifts = await db.shift.findMany({
    where: {
      startedAt: { lte: company.suspendedAt },
      ...(user.role === 'guard'
        ? { assignments: { some: { guardId: user.userId, isCurrent: true } } }
        : {}),
    },
    include: { syncState: true, site: true },
  });
  const pendingIds: string[] = [];
  const visibleIds: string[] = [];
  for (const shift of shifts) {
    const deadline =
      shift.syncDeadlineAt ??
      computeSyncDeadline(
        shift.endsAt,
        siteConnectivitySchema.parse({
          type: shift.connectivityType ?? 'with_signal',
          minutesToSignal: shift.minutesToSignal ?? 0,
          marginMinutes: shift.marginMinutes ?? 30,
        }),
      );
    const pending =
      !shift.closedWithoutDataAt &&
      (!shift.syncState?.syncedUntil ||
        shift.syncState.syncedUntil < (shift.closedAt ?? shift.endsAt) ||
        shift.syncState.lastPendingCount > 0);
    if (now < deadline && (shift.status === 'in_progress' || pending)) visibleIds.push(shift.id);
    if (now < deadline && pending) pendingIds.push(shift.id);
  }
  const alerts =
    user.role === 'guard'
      ? []
      : await db.panicAlert.findMany({
          where: { status: { not: 'resolved' }, shiftId: { in: shifts.map((s) => s.id) } },
          select: { id: true },
        });
  user.suspension = { shiftIds: visibleIds, panicIds: alerts.map((a) => a.id) };
  const id = String(request.params.id ?? '');
  if (classification === 'panic') {
    if (id ? !user.suspension.panicIds.includes(id) : !alerts.length)
      throw suspensionError(user.role);
  } else if (classification === 'notice') {
    const notice = id
      ? await db.notice.findFirst({ where: { id, shiftId: { in: visibleIds } } })
      : visibleIds.length;
    if (!notice) throw suspensionError(user.role);
  } else if (
    id
      ? !(classification === 'pending-sync' ? pendingIds : visibleIds).includes(id)
      : !visibleIds.length
  ) {
    throw suspensionError(user.role);
  }
}

import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  normalizeArPhone,
  sameArPhone,
  localDateTimeToUtc,
  searchTerms,
  type SmsInboundAuthResult,
  type SmsWebhookBody,
  type smsInboundQuerySchema,
} from '@garita/shared';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../common/clock';
import { PrismaService } from '../prisma/prisma.service';
import { PanicService } from '../panic/panic.service';
import { authenticatePanicSms } from './sms-authentication';

@Injectable()
export class SmsInboundService {
  private readonly logger = new Logger(SmsInboundService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly panic: PanicService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async receive(input: SmsWebhookBody) {
    const now = this.clock.now();
    // System webhook: no tenant exists until the shift code or sender identifies one.
    this.logger.log({ event: 'sms.inbound_system' });
    const db = this.prisma.systemPrisma;
    // Prisma's upsert races when the gateway delivers the same message twice at once (P2002);
    // ON CONFLICT DO NOTHING does not.
    await db.smsInbound.createMany({
      data: [
        {
          provider: 'http',
          messageId: input.id,
          fromOriginal: input.from,
          fromNormalized: normalizeArPhone(input.from),
          text: input.text,
          gatewayReceivedAt: new Date(input.receivedAt),
          receivedAt: now,
        },
      ],
      skipDuplicates: true,
    });
    const record = await db.smsInbound.findUniqueOrThrow({
      where: { provider_messageId: { provider: 'http', messageId: input.id } },
    });
    // Retry the original persisted message; a reused provider id cannot change its contents.
    if (record.processedAt && !record.alertId) return;
    if (record.alertId) {
      await this.panic.repairSmsDelivery(record.alertId);
      return;
    }
    const shifts = await db.shift.findMany({
      where: { status: 'in_progress' },
      include: {
        company: { select: { timezone: true } },
        assignments: {
          where: { isCurrent: true, active: true },
          include: { guard: { select: { phone: true } } },
        },
      },
    });
    const candidates = shifts.flatMap((shift) =>
      shift.assignments.flatMap((assignment) =>
        assignment.guardId && assignment.guard
          ? [
              {
                id: shift.id,
                companyId: shift.companyId,
                panicSmsCode: shift.panicSmsCode,
                assignmentId: assignment.id,
                guardId: assignment.guardId,
                phone: assignment.guard.phone,
              },
            ]
          : [],
      ),
    );
    const auth = authenticatePanicSms(record.text, record.fromOriginal, candidates);
    let companyId = auth.companyId;
    if (!companyId && !auth.candidate) {
      const guards = await db.user.findMany({
        where: { role: 'guard', status: 'active', phone: { not: null } },
        select: { phone: true, companyId: true },
      });
      const owners = [
        ...new Set(
          guards
            .filter((guard) => guard.phone && sameArPhone(guard.phone, record.fromOriginal))
            .map((guard) => guard.companyId),
        ),
      ];
      if (owners.length === 1) companyId = owners[0];
    }
    await db.smsInbound.update({
      where: { id: record.id },
      data: {
        result: auth.result,
        companyId: companyId ?? null,
        shiftId: auth.candidate?.id ?? null,
        ...(!auth.candidate ? { processedAt: now } : {}),
      },
    });
    if (auth.result !== 'valid')
      this.logger[auth.result === 'unknown' ? 'error' : 'warn']({
        event: 'sms.authentication',
        inboundId: record.id,
        result: auth.result,
      });
    if (!auth.candidate) return;
    const candidate = auth.candidate;
    const timezone =
      shifts.find((shift) => shift.id === candidate.id)?.company.timezone ??
      'America/Argentina/Buenos_Aires';
    const triggeredAt = smsTriggeredAt(auth.parsed?.time, record.gatewayReceivedAt, timezone);
    const latitude = auth.parsed?.latitude ?? null;
    const longitude = auth.parsed?.longitude ?? null;
    try {
      await this.panic.create(
        {
          alertId: randomUUID(),
          shiftId: candidate.id,
          occurredAtDevice: triggeredAt.toISOString(),
          location: {
            status: latitude !== null && longitude !== null ? 'ok' : 'unverifiable',
            latitude,
            longitude,
            accuracyMeters: null,
            simulation: 'unavailable',
            takenAt: null,
          },
        },
        {
          companyId: candidate.companyId,
          shiftId: candidate.id,
          assignmentId: candidate.assignmentId,
          userId: candidate.guardId,
          exp: 0,
        },
        {
          inboundId: record.id,
          shortId: auth.result === 'valid' ? (auth.parsed?.shortId ?? null) : null,
          unverified: auth.result === 'unverified',
          phoneMismatch: auth.phoneMismatch,
          receivedAt: record.receivedAt,
        },
      );
    } catch (error) {
      // The shift closed between the read and the alert: the message is kept, retrying cannot help.
      if (!(error instanceof ConflictException)) throw error;
      await db.smsInbound.update({ where: { id: record.id }, data: { processedAt: now } });
      this.logger.warn({ event: 'sms.shift_closed', inboundId: record.id });
      return;
    }
    this.logger.log({
      event: 'sms.processed',
      inboundId: record.id,
      result: auth.result,
      latencyMs: this.clock.now().getTime() - now.getTime(),
    });
  }

  async list(query: z.infer<typeof smsInboundQuerySchema>) {
    const db = this.prisma.tenantPrisma;
    // Cada palabra tiene que aparecer en el número o en el texto.
    const terms = searchTerms(query.buscar);
    const base = {
      AND: terms.map((term) => ({
        OR: [
          { fromOriginal: { contains: term, mode: 'insensitive' as const } },
          { fromNormalized: { contains: term } },
          { text: { contains: term, mode: 'insensitive' as const } },
        ],
      })),
    };
    const where = { ...base, result: query.estado };
    const count = (result: SmsInboundAuthResult) =>
      db.smsInbound.count({ where: { ...base, result } });
    const [rows, valid, unverified, unknown] = await Promise.all([
      db.smsInbound.findMany({
        where,
        orderBy: [
          query.orden === 'origen'
            ? { fromNormalized: query.sentido }
            : query.orden === 'estado'
              ? { result: query.sentido }
              : { receivedAt: query.sentido },
          // Dentro del mismo origen o estado, lo más nuevo primero; el id desempata.
          { receivedAt: 'desc' },
          { id: 'desc' },
        ],
        skip: (query.pagina - 1) * query.porPagina,
        take: query.porPagina,
        include: {
          alert: {
            select: {
              site: { select: { name: true } },
              guard: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
      count('valid'),
      count('unverified'),
      count('unknown'),
    ]);
    const resumen = { valid, unverified, unknown };
    const total = query.estado ? resumen[query.estado] : valid + unverified + unknown;
    // Sin alerta no hay vigilador autenticado: se deduce de las asignaciones del turno.
    const shiftIds = [
      ...new Set(rows.flatMap((row) => (row.shiftId && !row.alert ? [row.shiftId] : []))),
    ];
    const shifts = shiftIds.length
      ? await db.shift.findMany({
          where: { id: { in: shiftIds } },
          select: {
            id: true,
            site: { select: { name: true } },
            // Incluye las reemplazadas (active: false) para no atribuirle el SMS al relevo.
            assignments: {
              select: { guardId: true, createdAt: true },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            },
          },
        })
      : [];
    const guardIds = [
      ...new Set(
        shifts.flatMap((shift) => shift.assignments.flatMap((a) => (a.guardId ? [a.guardId] : []))),
      ),
    ];
    const guards = guardIds.length
      ? await db.user.findMany({
          where: { id: { in: guardIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const guardName = new Map(guards.map((g) => [g.id, `${g.firstName} ${g.lastName}`]));
    const shiftById = new Map(shifts.map((shift) => [shift.id, shift]));
    const senderOf = (row: (typeof rows)[number]) => {
      if (row.alert)
        return {
          guardName: `${row.alert.guard.firstName} ${row.alert.guard.lastName}`,
          siteName: row.alert.site.name,
        };
      const shift = row.shiftId ? shiftById.get(row.shiftId) : undefined;
      if (!shift) return null;
      // Un relevo crea una asignación nueva: vale la última creada antes de que llegue el SMS.
      const assignment =
        shift.assignments.findLast((a) => a.createdAt <= row.receivedAt) ?? shift.assignments[0];
      return {
        guardName: (assignment?.guardId && guardName.get(assignment.guardId)) ?? null,
        siteName: shift.site.name,
      };
    };
    return {
      resumen,
      items: rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        messageId: row.messageId,
        fromOriginal: row.fromOriginal,
        fromNormalized: row.fromNormalized,
        text: row.text,
        receivedAt: row.receivedAt.toISOString(),
        gatewayReceivedAt: row.gatewayReceivedAt.toISOString(),
        result: row.result,
        alertId: row.alertId,
        shiftId: row.shiftId,
        sender: senderOf(row),
      })),
      total,
      page: query.pagina,
      pageSize: query.porPagina,
    };
  }
}

/** The SMS has only HH:mm; choose the nearest local day to gateway reception, then internet supplies the full instant. */
export function smsTriggeredAt(time: string | undefined, receivedAt: Date, timezone: string): Date {
  if (!time) return receivedAt;
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(receivedAt);
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const candidates = [-1440, 0, 1440].map((offset) =>
    localDateTimeToUtc(date, hour * 60 + minute + offset, timezone),
  );
  return (
    candidates.sort(
      (a, b) =>
        Math.abs(a.getTime() - receivedAt.getTime()) - Math.abs(b.getTime() - receivedAt.getTime()),
    )[0] ?? receivedAt
  );
}

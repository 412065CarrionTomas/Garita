import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  normalizeArPhone,
  sameArPhone,
  localDateTimeToUtc,
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
    const where = query.estado ? { result: query.estado } : {};
    const [rows, total] = await Promise.all([
      this.prisma.tenantPrisma.smsInbound.findMany({
        where,
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        skip: (query.pagina - 1) * 25,
        take: 25,
      }),
      this.prisma.tenantPrisma.smsInbound.count({ where }),
    ]);
    return {
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
      })),
      total,
      page: query.pagina,
      pageSize: 25,
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

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  evaluateRecordFlags,
  DEFAULT_SPEEDS_KMH,
  type RecordFlagSeverity,
  type ShiftRecordsResponse,
  type UpdateSiteSpeedInput,
} from '@garita/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantResourceService } from '../auth/tenant-resource.service';
import type { AuthenticatedUser } from '../auth/auth.types';

export interface EvaluateRecordInput {
  id: string;
  recordId: string;
  shiftId: string;
  companyId: string;
  checkpointId: string;
  method: 'qr' | 'nfc';
  occurredAtDevice: Date;
  locationStatus: 'ok' | 'unverifiable' | 'disabled';
  latitude: Prisma.Decimal | number | null;
  longitude: Prisma.Decimal | number | null;
  accuracyMeters: Prisma.Decimal | number | null;
  simulation: 'simulated' | 'not_simulated' | 'unavailable';
  phoneNfc: 'on' | 'off' | 'unsupported';
}

@Injectable()
export class MarcasService {
  private readonly logger = new Logger(MarcasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: TenantResourceService,
  ) {}

  /**
   * Evaluates suspicious record flags and saves them in the database.
   * NEVER throws an exception or blocks saving the record (CA5).
   */
  async evaluateRecord(record: EvaluateRecordInput): Promise<void> {
    const startTime = performance.now();
    try {
      // 1. Load checkpoint, site maxSpeedKmh, and active NFC tags
      const checkpoint = await this.prisma.tenantPrisma.checkpoint.findUnique({
        where: { id: record.checkpointId },
        select: {
          id: true,
          latitude: true,
          longitude: true,
          toleranceRadiusMeters: true,
          isIndoor: true,
          site: {
            select: { maxSpeedKmh: true },
          },
          nfcTags: {
            where: { status: 'active' },
            take: 1,
            select: { id: true },
          },
        },
      });

      if (!checkpoint) {
        this.logger.warn({
          event: 'checkpoint_not_found_for_flags',
          checkpointId: record.checkpointId,
          recordId: record.recordId,
        });
        return;
      }

      // 2. Load previous record of the same shift (if any)
      const previousRecord = await this.prisma.tenantPrisma.checkpointRecord.findFirst({
        where: {
          shiftId: record.shiftId,
          occurredAtDevice: { lt: record.occurredAtDevice },
        },
        orderBy: { occurredAtDevice: 'desc' },
        select: {
          occurredAtDevice: true,
          checkpoint: {
            select: { id: true, latitude: true, longitude: true },
          },
        },
      });

      // 3. Evaluate flags deterministically
      const flags = evaluateRecordFlags({
        record: {
          method: record.method,
          occurredAtDevice: record.occurredAtDevice.toISOString(),
          location: {
            status: record.locationStatus,
            latitude: record.latitude !== null ? Number(record.latitude) : null,
            longitude: record.longitude !== null ? Number(record.longitude) : null,
            accuracyMeters: record.accuracyMeters !== null ? Number(record.accuracyMeters) : null,
            simulation: record.simulation,
          },
          phoneNfc: record.phoneNfc,
        },
        checkpoint: {
          id: checkpoint.id,
          latitude: Number(checkpoint.latitude),
          longitude: Number(checkpoint.longitude),
          toleranceRadiusMeters: checkpoint.toleranceRadiusMeters,
          isIndoor: checkpoint.isIndoor,
          hasActiveNfcTag: checkpoint.nfcTags.length > 0,
        },
        previousRecord: previousRecord
          ? {
              occurredAtDevice: previousRecord.occurredAtDevice.toISOString(),
              checkpoint: {
                id: previousRecord.checkpoint.id,
                latitude: Number(previousRecord.checkpoint.latitude),
                longitude: Number(previousRecord.checkpoint.longitude),
              },
            }
          : null,
        site: {
          maxSpeedKmh: checkpoint.site.maxSpeedKmh,
        },
      });

      // 4. Save flags idempotently
      if (flags.length > 0) {
        await this.prisma.tenantPrisma.recordFlag.createMany({
          data: flags.map((flag) => ({
            companyId: record.companyId,
            checkpointRecordId: record.id,
            shiftId: record.shiftId,
            type: flag.type,
            severity: flag.severity,
            reason: flag.reason ?? null,
            details: (flag.details ?? null) as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        });
      }

      const elapsedMs = performance.now() - startTime;
      this.logger.log({
        event: 'record_flags_evaluated',
        recordId: record.recordId,
        flagsCount: flags.length,
        elapsedMs: Math.round(elapsedMs * 100) / 100,
      });
    } catch (error) {
      this.logger.error({
        event: 'record_flag_evaluation_failed',
        recordId: record.recordId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Retrieves all records of a shift with their flags, reasons, severity,
   * and the "phoneWithoutNfc" indicator.
   */
  async getShiftRecords(
    shiftId: string,
    options: { marcados?: boolean; gravedad?: RecordFlagSeverity },
    user: AuthenticatedUser,
  ): Promise<ShiftRecordsResponse> {
    // 1. Verify shift exists and is accessible for the tenant / supervisor
    const shift = await this.prisma.tenantPrisma.shift.findFirst({
      where: { id: shiftId },
      select: { id: true, siteId: true },
    });
    if (!shift) {
      throw new NotFoundException('Turno no encontrado');
    }

    // 2. Fetch all checkpoint records of the shift
    const records = await this.prisma.tenantPrisma.checkpointRecord.findMany({
      where: { shiftId },
      orderBy: { occurredAtDevice: 'asc' },
      include: {
        flags: {
          where: options.gravedad ? { severity: options.gravedad } : undefined,
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    const phoneWithoutNfc = records.some((r) => r.phoneNfc === 'unsupported');

    // Filter by marcados if requested
    const filteredRecords = options.marcados ? records.filter((r) => r.flags.length > 0) : records;

    return {
      shiftId: shift.id,
      phoneWithoutNfc,
      records: filteredRecords.map((r) => ({
        id: r.id,
        recordId: r.recordId,
        shiftId: r.shiftId,
        checkpointId: r.checkpointId,
        method: r.method,
        occurredAtDevice: r.occurredAtDevice.toISOString(),
        receivedAt: r.receivedAt.toISOString(),
        locationStatus: r.locationStatus,
        latitude: r.latitude !== null ? Number(r.latitude) : null,
        longitude: r.longitude !== null ? Number(r.longitude) : null,
        accuracyMeters: r.accuracyMeters !== null ? Number(r.accuracyMeters) : null,
        simulation: r.simulation,
        phoneNfc: r.phoneNfc,
        outOfWindow: r.outOfWindow,
        countsForCompliance: r.countsForCompliance,
        flags: r.flags.map((f) => ({
          id: f.id,
          type: f.type,
          severity: f.severity,
          reason: f.reason,
          details: (f.details as Record<string, unknown>) ?? null,
          createdAt: f.createdAt.toISOString(),
        })),
      })),
    };
  }

  /**
   * Updates site max speed profile and speed in km/h.
   */
  async updateSiteSpeed(siteId: string, input: UpdateSiteSpeedInput, user: AuthenticatedUser) {
    // findOwnedOrThrow throws 404 if site doesn't belong to company or supervisor not assigned
    await this.resources.findOwnedOrThrow('Site', siteId);

    const speedKmh =
      input.maxSpeedProfile === 'custom'
        ? input.maxSpeedKmh!
        : (input.maxSpeedKmh ?? DEFAULT_SPEEDS_KMH[input.maxSpeedProfile]);

    const updated = await this.prisma.tenantPrisma.site.update({
      where: { id: siteId },
      data: {
        maxSpeedProfile: input.maxSpeedProfile,
        maxSpeedKmh: speedKmh,
      },
    });

    return updated;
  }
}

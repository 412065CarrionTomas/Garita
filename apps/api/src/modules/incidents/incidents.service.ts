import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { IncidentReport } from '@garita/shared';
import { Prisma } from '../../generated/prisma/client';
import {
  INCIDENT_PHOTO_MAX_BYTES,
  PHOTO_STORAGE_PORT,
  type PhotoStoragePort,
} from './photo-storage.port';
import { PrismaService } from '../prisma/prisma.service';
import { CLOCK, type Clock } from '../../common/clock';
import { clockFields } from '../server-time/clock-fields';
import { NOTIFICATIONS_PORT, type NotificationsPort } from '../../common/ports/notifications.port';
import { REALTIME_PORT, type RealtimePort } from '../../common/ports/realtime.port';
import type { ShiftCredentialPayload } from '../sync/shift-credential.service';

const INCIDENT_ACCEPTING_STATUSES = new Set(['in_progress', 'closed', 'auto_closed']);

@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NOTIFICATIONS_PORT) private readonly notifications: NotificationsPort,
    @Inject(REALTIME_PORT) private readonly realtime: RealtimePort,
    @Inject(PHOTO_STORAGE_PORT) private readonly photos: PhotoStoragePort,
  ) {}

  async receive(
    input: IncidentReport,
    credential: ShiftCredentialPayload,
  ): Promise<
    | { duplicate: true; same: boolean }
    | { duplicate: false; result: { incidentId: string; classificationStatus: 'pending' } }
    | null
  > {
    if (input.shiftId !== credential.shiftId) return null;
    // HU-13 credentials do not create Firebase tenant context; every systemPrisma query below scopes explicitly to that credential.
    const existing = await this.prisma.systemPrisma.incident.findUnique({
      where: { incidentId: input.incidentId },
    });
    if (existing)
      return {
        duplicate: true,
        same: existing.companyId === credential.companyId && existing.shiftId === input.shiftId,
      };
    const shift = await this.prisma.systemPrisma.shift.findFirst({
      where: { id: input.shiftId, companyId: credential.companyId },
      include: {
        assignments: {
          where: {
            id: credential.assignmentId,
            guardId: credential.userId,
            isCurrent: true,
            active: true,
          },
          take: 1,
        },
      },
    });
    const assignment = shift?.assignments[0];
    // Offline incidents may sync after the shift closed (guard, admin or auto), like records do.
    if (!shift || !assignment || !INCIDENT_ACCEPTING_STATUSES.has(shift.status)) return null;
    const receivedAt = this.clock.now();
    const incident = await this.prisma.systemPrisma.incident
      .create({
        data: {
          companyId: credential.companyId,
          siteId: shift.siteId,
          shiftId: shift.id,
          assignmentId: assignment.id,
          guardId: credential.userId,
          incidentId: input.incidentId,
          type: input.type,
          description: input.description,
          occurredAtDevice: new Date(input.occurredAtDevice),
          receivedAt,
          ...clockFields(input.clock),
          locationStatus: input.location.status,
          latitude: input.location.latitude,
          longitude: input.location.longitude,
          accuracyMeters: input.location.accuracyMeters,
          simulation: input.location.simulation,
        },
      })
      .catch((error: unknown) => {
        // Two deliveries of the same offline incident can race past the lookup above.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
          throw error;
        return null;
      });
    if (!incident) {
      const stored = await this.prisma.systemPrisma.incident.findUnique({
        where: { incidentId: input.incidentId },
      });
      return {
        duplicate: true,
        same: stored?.companyId === credential.companyId && stored.shiftId === input.shiftId,
      };
    }
    const portResults = await Promise.allSettled([
      this.notifications.notifySiteStaff({
        companyId: credential.companyId,
        siteId: shift.siteId,
        kind: 'incident_new',
        payload: { kind: 'incident_new', link: `/incidentes/${incident.id}` },
      }),
      Promise.resolve().then(() => {
        this.realtime.emitToSite(credential.companyId, shift.siteId, 'incidente.nuevo', {
          incidentId: incident.id,
          siteId: shift.siteId,
        });
      }),
    ]);
    if (portResults.some((result) => result.status === 'rejected'))
      this.logger.warn({ event: 'incident.notification_failed', incidentId: incident.id });
    this.logger.log({ event: 'incident.created', incidentId: incident.id, siteId: shift.siteId });
    return {
      duplicate: false,
      result: { incidentId: input.incidentId, classificationStatus: 'pending' as const },
    };
  }

  async authorizePhoto(id: string, credential: ShiftCredentialPayload) {
    const incident = await this.ownedIncident(id, credential);
    return this.prisma.systemPrisma.$transaction(async (tx) => {
      // Serializa autorizaciones y confirmaciones del incidente propio de la credencial.
      await tx.$queryRaw`SELECT id FROM "Incident" WHERE id = ${incident.id} FOR UPDATE`;
      await tx.incidentPhotoAuthorization.deleteMany({
        where: { incidentId: incident.id, expiresAt: { lte: this.clock.now() } },
      });
      const photoCount = await tx.incidentPhoto.count({ where: { incidentId: incident.id } });
      if (photoCount >= 5) throw new ConflictException('El incidente ya tiene cinco fotos');
      const authorization = await this.photos.authorizeUpload(
        credential.companyId,
        incident.incidentId,
      );
      if (
        !authorization.publicId.startsWith(
          `incidentes/${credential.companyId}/${incident.incidentId}/`,
        )
      )
        throw new Error('La autorización generó un identificador inesperado');
      // Los reintentos reemplazan las autorizaciones más viejas, sin consumir cupo de fotos reales.
      const replaced = await tx.incidentPhotoAuthorization.findMany({
        where: { incidentId: incident.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 4 - photoCount,
        select: { id: true },
      });
      await tx.incidentPhotoAuthorization.deleteMany({
        where: { id: { in: replaced.map(({ id: authorizationId }) => authorizationId) } },
      });
      await tx.incidentPhotoAuthorization.create({
        data: {
          incidentId: incident.id,
          cloudinaryPublicId: authorization.publicId,
          expiresAt: new Date(this.clock.now().getTime() + 15 * 60_000),
        },
      });
      return { ...authorization, maxBytes: INCIDENT_PHOTO_MAX_BYTES };
    });
  }

  async registerPhoto(id: string, credential: ShiftCredentialPayload, publicId: string) {
    const incident = await this.ownedIncident(id, credential);
    const authorization = await this.prisma.systemPrisma.incidentPhotoAuthorization.findFirst({
      where: {
        incidentId: incident.id,
        cloudinaryPublicId: publicId,
        expiresAt: { gt: this.clock.now() },
      },
    });
    if (!authorization) throw new NotFoundException();
    const count = await this.prisma.systemPrisma.incidentPhoto.count({
      where: { incidentId: incident.id },
    });
    if (count >= 5) throw new ConflictException('El incidente ya tiene cinco fotos');
    const uploaded = await this.photos.inspectUpload(publicId);
    if (!uploaded)
      throw new ServiceUnavailableException('La foto todavía no está disponible en Cloudinary');
    if (uploaded.bytes > INCIDENT_PHOTO_MAX_BYTES)
      throw new ConflictException('La foto supera los 3 MB');
    try {
      return await this.prisma.systemPrisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM "Incident" WHERE id = ${incident.id} FOR UPDATE`;
        const currentCount = await transaction.incidentPhoto.count({
          where: { incidentId: incident.id },
        });
        if (currentCount >= 5) throw new ConflictException('El incidente ya tiene cinco fotos');
        const consumed = await transaction.incidentPhotoAuthorization.deleteMany({
          where: {
            incidentId: incident.id,
            cloudinaryPublicId: publicId,
            expiresAt: { gt: this.clock.now() },
          },
        });
        if (consumed.count !== 1) throw new NotFoundException();
        const photo = await transaction.incidentPhoto.create({
          data: { incidentId: incident.id, cloudinaryPublicId: publicId, ...uploaded },
        });
        this.logger.log({
          event: 'incident.photo_registered',
          incidentId: incident.id,
          bytes: uploaded.bytes,
          width: uploaded.width,
          height: uploaded.height,
        });
        return photo;
      });
    } catch {
      throw new ConflictException('La foto ya fue registrada o se alcanzó el límite de cinco');
    }
  }

  private async ownedIncident(id: string, credential: ShiftCredentialPayload) {
    const incident = await this.prisma.systemPrisma.incident.findFirst({
      where: {
        incidentId: id,
        companyId: credential.companyId,
        shiftId: credential.shiftId,
        assignmentId: credential.assignmentId,
        guardId: credential.userId,
      },
    });
    if (!incident) throw new NotFoundException('Incidente no encontrado');
    return incident;
  }
}

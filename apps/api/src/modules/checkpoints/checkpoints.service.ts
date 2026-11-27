import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { CheckpointArrangementInput } from '@garita/shared';
import { Prisma } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { PrismaService } from '../prisma/prisma.service';
import { SitesService } from '../sites/sites.service';
import { CHECKPOINT_USAGE_PORT, type CheckpointUsagePort } from './checkpoints-usage.port';
import { QrService } from './qr.service';

interface CheckpointInput {
  name: string;
  latitude: number;
  longitude: number;
  toleranceRadiusMeters: number;
  stickerLocation?: string;
  address?: string | null;
  isIndoor: boolean;
  confirmFarLocation?: boolean;
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(bLat - aLat);
  const dLng = radians(bLng - aLng);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

@Injectable()
export class CheckpointsService {
  private readonly logger = new Logger(CheckpointsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: TenantResourceService,
    private readonly sites: SitesService,
    private readonly qr: QrService,
    @Inject(CHECKPOINT_USAGE_PORT) private readonly usage: CheckpointUsagePort,
  ) {}

  async list(siteId: string, includeNfcTag = false, user?: AuthenticatedUser) {
    await this.resources.findOwnedOrThrow('Site', siteId);
    const [checkpoints, rounds] = await Promise.all([
      this.prisma.tenantPrisma.checkpoint.findMany({
        where: { siteId, status: 'active' },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
        include: {
          nfcTags: {
            where: { status: 'active' },
            take: 1,
            select: { status: true, associatedAt: true, uid: true, kind: true },
          },
        },
      }),
      this.usage.countActiveRoundsBySite(siteId),
    ]);
    return checkpoints.map(({ nfcTags, ...checkpoint }) => {
      const tag = nfcTags.at(0);
      return {
        ...checkpoint,
        roundsCount: rounds.get(checkpoint.id) ?? 0,
        tagType: !tag ? 'qr' : tag.kind === 'secure' ? 'nfc_secure' : 'nfc_basic',
        ...(includeNfcTag && {
          etiquetaNfc: tag
            ? {
                status: tag.status,
                associatedAt: tag.associatedAt,
                ...(user?.role === 'admin' ? { uid: tag.uid } : {}),
              }
            : null,
        }),
      };
    });
  }

  async create(siteId: string, input: CheckpointInput, user: AuthenticatedUser) {
    const site = await this.sites.assertSiteIsActive(siteId, user);
    this.assertNearSite(input, site.latitude.toNumber(), site.longitude.toNumber());
    // El punto nuevo va al final de la numeración del predio.
    const last = await this.prisma.tenantPrisma.checkpoint.aggregate({
      where: { siteId },
      _max: { position: true },
    });
    try {
      const checkpoint = await this.prisma.tenantPrisma.checkpoint.create({
        data: {
          companyId: user.companyId,
          siteId,
          name: input.name,
          latitude: input.latitude,
          longitude: input.longitude,
          toleranceRadiusMeters: input.toleranceRadiusMeters,
          stickerLocation: input.stickerLocation,
          address: input.address,
          isIndoor: input.isIndoor,
          position: (last._max.position ?? 0) + 1,
          qrVersion: 1,
        },
      });
      this.logger.log({
        action: 'checkpoint.created',
        checkpointId: checkpoint.id,
        userId: user.userId,
      });
      return checkpoint;
    } catch (error) {
      this.handleUnique(error);
    }
  }

  async update(id: string, input: CheckpointInput, user: AuthenticatedUser) {
    const existing = await this.resources.findOwnedOrThrow('Checkpoint', id);
    const siteId = String(existing.siteId);
    const site = await this.sites.assertSiteIsActive(siteId, user);
    this.assertNearSite(input, site.latitude.toNumber(), site.longitude.toNumber());
    try {
      const updated = await this.prisma.tenantPrisma.checkpoint.update({
        where: { id },
        data: {
          name: input.name,
          latitude: input.latitude,
          longitude: input.longitude,
          toleranceRadiusMeters: input.toleranceRadiusMeters,
          stickerLocation: input.stickerLocation,
          address: input.address,
          isIndoor: input.isIndoor,
        },
      });
      this.logger.log({ action: 'checkpoint.updated', checkpointId: id, userId: user.userId });
      return updated;
    } catch (error) {
      this.handleUnique(error);
    }
  }

  /** Guarda de una vez el orden y la ubicación de todos los puntos activos del predio. */
  async arrange(siteId: string, input: CheckpointArrangementInput, user: AuthenticatedUser) {
    const site = await this.sites.assertSiteIsActive(siteId, user);
    const outdated = () =>
      new ConflictException({
        code: 'CHECKPOINT_LIST_OUTDATED',
        message: 'Los puntos del predio cambiaron. Recargá la página y volvé a intentar.',
      });
    // Leer, validar y escribir en la misma transacción: otro usuario pudo sumar o dar de baja
    // puntos mientras tanto y no se pisa a ciegas.
    await this.prisma.tenantPrisma.$transaction(async (tx) => {
      const current = await tx.checkpoint.findMany({
        where: { siteId, status: 'active' },
        select: { id: true, latitude: true, longitude: true },
      });
      const byId = new Map(current.map((point) => [point.id, point]));
      const ids = new Set(input.puntos.map(({ id }) => id));
      if (
        ids.size !== input.puntos.length ||
        ids.size !== byId.size ||
        input.puntos.some(({ id }) => !byId.has(id))
      )
        throw outdated();
      for (const point of input.puntos) {
        const before = byId.get(point.id);
        if (
          before &&
          (before.latitude.toNumber() !== point.latitude ||
            before.longitude.toNumber() !== point.longitude)
        )
          this.assertNearSite(
            { ...point, confirmFarLocation: input.confirmFarLocation },
            site.latitude.toNumber(),
            site.longitude.toNumber(),
          );
      }
      for (const [index, point] of input.puntos.entries()) {
        // Solo si sigue activo en este predio: si lo dieron de baja recién, la lista quedó vieja.
        const { count } = await tx.checkpoint.updateMany({
          where: { id: point.id, siteId, status: 'active' },
          data: {
            position: index + 1,
            latitude: point.latitude,
            longitude: point.longitude,
            address: point.address,
          },
        });
        if (count !== 1) throw outdated();
      }
    });
    this.logger.log({ action: 'checkpoint.arranged', siteId, userId: user.userId });
    return this.list(siteId);
  }

  async deactivate(id: string, user: AuthenticatedUser) {
    await this.resources.findOwnedOrThrow('Checkpoint', id);
    const rounds = await this.usage.findActiveRoundsUsing(id);
    if (rounds.length)
      throw new ConflictException({
        code: 'CHECKPOINT_IN_ACTIVE_ROUNDS',
        message: 'Quitá el punto de las rondas activas antes de darlo de baja',
        rounds: rounds.map(({ id: roundId, name }) => ({ id: roundId, name })),
      });
    const pinned = await this.prisma.tenantPrisma.roundVersionCheckpoint.findFirst({
      where: {
        checkpointId: id,
        roundVersion: { shifts: { some: { shift: { status: 'in_progress' } } } },
      },
    });
    if (pinned)
      throw new ConflictException({
        code: 'CHECKPOINT_IN_PROGRESS_SHIFT',
        message: 'El punto está incluido en una ronda de un turno en curso',
      });
    const updated = await this.prisma.tenantPrisma.$transaction(async (tx) => {
      await tx.nfcTag.updateMany({
        where: { checkpointId: id, status: 'active' },
        data: { status: 'removed', endedAt: new Date(), endedById: user.userId },
      });
      return tx.checkpoint.update({ where: { id }, data: { status: 'inactive' } });
    });
    this.logger.log({ action: 'checkpoint.deactivated', checkpointId: id, userId: user.userId });
    return updated;
  }

  async regenerateQr(id: string, user: AuthenticatedUser) {
    await this.resources.findOwnedOrThrow('Checkpoint', id);
    const checkpoint = await this.prisma.tenantPrisma.checkpoint.update({
      where: { id },
      data: { qrVersion: { increment: 1 } },
    });
    this.logger.log({ action: 'checkpoint.qr_regenerated', checkpointId: id, userId: user.userId });
    return { checkpoint, qrPayload: this.qr.createPayload(checkpoint.id, checkpoint.qrVersion) };
  }

  async createStickerPdf(siteId: string, ids?: string[]): Promise<Buffer> {
    await this.resources.findOwnedOrThrow('Site', siteId);
    if (ids?.some((id) => !id)) throw new NotFoundException('Punto no encontrado');
    const checkpoints = await this.prisma.tenantPrisma.checkpoint.findMany({
      where: { siteId, status: 'active', ...(ids ? { id: { in: ids } } : {}) },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    if (ids && checkpoints.length !== new Set(ids).size)
      throw new NotFoundException('Punto no encontrado');
    if (!checkpoints.length) throw new BadRequestException('No hay puntos para imprimir');
    const PDFDocument = (await import('pdfkit')).default;
    const document = new PDFDocument({ size: 'A4', margin: 28 });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    const finished = new Promise<Buffer>((resolve, reject) => {
      document.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      document.on('error', reject);
    });
    const columnWidth = 181;
    const rowHeight = 185;
    const qrSize = 113.4; // 4 cm at 72 points per inch.
    const perPage = 8;
    const qrCode = await import('qrcode');
    const images = await Promise.all(
      checkpoints.map((checkpoint) =>
        qrCode.toString(this.qr.createPayload(checkpoint.id, checkpoint.qrVersion), {
          type: 'svg',
          errorCorrectionLevel: 'H',
          margin: 4,
        }),
      ),
    );
    for (const [index, checkpoint] of checkpoints.entries()) {
      if (index > 0 && index % perPage === 0) document.addPage();
      const withinPage = index % perPage;
      const column = withinPage % 3;
      const row = Math.floor(withinPage / 3);
      const x = 25 + column * columnWidth;
      const y = 35 + row * rowHeight;
      const image = images[index];
      if (!image) continue;
      const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(image);
      const darkPath = [...image.matchAll(/<path[^>]*d="([^"]+)"/g)].at(-1)?.[1];
      if (!viewBox?.[1] || !darkPath)
        throw new Error('El QR SVG generado no tiene el formato esperado');
      const qrX = x + (columnWidth - qrSize) / 2;
      document.rect(qrX, y, qrSize, qrSize).fill('white');
      document
        .save()
        .translate(qrX, y)
        .scale(qrSize / Number(viewBox[1]))
        .path(darkPath)
        .fill('black')
        .restore();
      document.fontSize(10).text(checkpoint.name, x, y + qrSize + 8, {
        width: columnWidth,
        align: 'center',
        height: 28,
        ellipsis: true,
      });
    }
    document.end();
    return finished;
  }

  private assertNearSite(
    input: Pick<CheckpointInput, 'latitude' | 'longitude' | 'confirmFarLocation'>,
    latitude: number,
    longitude: number,
  ): void {
    if (
      distanceMeters(latitude, longitude, input.latitude, input.longitude) > 1000 &&
      !input.confirmFarLocation
    )
      throw new ConflictException({
        code: 'CHECKPOINT_LOCATION_REQUIRES_CONFIRMATION',
        message: 'El punto está a más de 1 km del predio. Confirmá su ubicación para continuar.',
      });
  }

  private handleUnique(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new ConflictException({
        code: 'CHECKPOINT_NAME_ALREADY_EXISTS',
        message: 'Ya existe un punto con ese nombre en el predio',
      });
    throw error;
  }
}

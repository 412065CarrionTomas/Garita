import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

  async list(siteId: string) {
    await this.resources.findOwnedOrThrow('Site', siteId);
    return this.prisma.tenantPrisma.checkpoint.findMany({
      where: { siteId, status: 'active' },
      orderBy: { name: 'asc' },
    });
  }

  async create(siteId: string, input: CheckpointInput, user: AuthenticatedUser) {
    const site = await this.sites.assertSiteIsActive(siteId, user);
    this.assertNearSite(input, site.latitude.toNumber(), site.longitude.toNumber());
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
          isIndoor: input.isIndoor,
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
          isIndoor: input.isIndoor,
        },
      });
      this.logger.log({ action: 'checkpoint.updated', checkpointId: id, userId: user.userId });
      return updated;
    } catch (error) {
      this.handleUnique(error);
    }
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
    const updated = await this.prisma.tenantPrisma.checkpoint.update({
      where: { id },
      data: { status: 'inactive' },
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
      orderBy: { name: 'asc' },
    });
    if (ids && checkpoints.length !== new Set(ids).size)
      throw new NotFoundException('Punto no encontrado');
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
        .stroke('black')
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

  private assertNearSite(input: CheckpointInput, latitude: number, longitude: number): void {
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

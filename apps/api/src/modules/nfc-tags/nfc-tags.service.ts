import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { AssociateNfcTag } from '@garita/shared';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NfcTagsService {
  private readonly logger = new Logger(NfcTagsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: TenantResourceService,
  ) {}

  async configurationSites(_user: AuthenticatedUser) {
    const sites = await this.prisma.tenantPrisma.site.findMany({
      where: { status: 'active' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    return sites;
  }

  async associate(checkpointId: string, input: AssociateNfcTag, user: AuthenticatedUser) {
    const checkpoint = await this.prisma.tenantPrisma.checkpoint.findFirst({
      where: { id: checkpointId, status: 'active' },
      include: { site: { select: { name: true } } },
    });
    if (!checkpoint) throw new NotFoundException('Recurso no encontrado');
    // systemPrisma is intentionally used to enforce global UID uniqueness across tenants; the audit log below records the cross-company probe without exposing the owner.
    const globalTag = await this.prisma.systemPrisma.nfcTag.findFirst({
      where: { uid: input.uid, status: 'active' },
      include: { checkpoint: { include: { site: true } } },
    });
    if (globalTag && globalTag.companyId !== user.companyId) {
      this.logger.warn({
        action: 'nfc_tag.cross_company_uid_rejected',
        userId: user.userId,
        companyId: user.companyId,
        uid: input.uid,
      });
      throw new UnprocessableEntityException('Etiqueta no disponible');
    }
    if (globalTag && user.role === 'supervisor' && globalTag.checkpointId !== checkpointId) {
      const visibleTag = await this.prisma.tenantPrisma.nfcTag.findFirst({
        where: { id: globalTag.id },
      });
      if (!visibleTag) throw new NotFoundException('Recurso no encontrado');
    }
    if (globalTag && globalTag.checkpointId !== checkpointId && !input.confirmMove) {
      throw new ConflictException({
        code: 'NFC_TAG_MOVE_CONFIRMATION_REQUIRED',
        message: 'La etiqueta está asociada a otro punto',
        checkpointName: globalTag.checkpoint.name,
      });
    }
    try {
      const result = await this.prisma.tenantPrisma.$transaction(async (tx) => {
        const previousAtTarget = await tx.nfcTag.findFirst({
          where: { checkpointId, status: 'active' },
        });
        if (previousAtTarget && previousAtTarget.uid !== input.uid) {
          await tx.nfcTag.update({
            where: { id: previousAtTarget.id },
            data: { status: 'replaced', endedAt: new Date(), endedById: user.userId },
          });
          this.logger.log({
            action: 'nfc_tag.replaced',
            checkpointId,
            tagId: previousAtTarget.id,
            userId: user.userId,
          });
        }
        if (globalTag && globalTag.checkpointId !== checkpointId) {
          await tx.nfcTag.update({
            where: { id: globalTag.id },
            data: { status: 'replaced', endedAt: new Date(), endedById: user.userId },
          });
        }
        if (globalTag?.checkpointId === checkpointId) return globalTag;
        return tx.nfcTag.create({
          data: {
            companyId: user.companyId,
            checkpointId,
            uid: input.uid,
            associatedById: user.userId,
          },
        });
      });
      this.logger.log({
        action:
          globalTag?.checkpointId === checkpointId
            ? 'nfc_tag.association_unchanged'
            : globalTag
              ? 'nfc_tag.moved'
              : 'nfc_tag.associated',
        checkpointId,
        tagId: result.id,
        userId: user.userId,
      });
      return { id: result.id, status: result.status, associatedAt: result.associatedAt };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException({
          code: 'NFC_TAG_CONCURRENT_ASSOCIATION',
          message: 'La etiqueta cambió de asociación. Actualizá el punto e intentá de nuevo.',
        });
      throw error;
    }
  }

  async remove(checkpointId: string, user: AuthenticatedUser) {
    await this.resources.findOwnedOrThrow('Checkpoint', checkpointId);
    const active = await this.prisma.tenantPrisma.nfcTag.findFirst({
      where: { checkpointId, status: 'active' },
    });
    if (!active) throw new NotFoundException('El punto no tiene una etiqueta vigente');
    const removed = await this.prisma.tenantPrisma.nfcTag.update({
      where: { id: active.id },
      data: { status: 'removed', endedAt: new Date(), endedById: user.userId },
    });
    this.logger.log({
      action: 'nfc_tag.removed',
      checkpointId,
      tagId: removed.id,
      userId: user.userId,
    });
    return { id: removed.id, status: removed.status, endedAt: removed.endedAt };
  }
}

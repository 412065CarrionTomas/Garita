import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SecureTagStart, SecureTagConfirm } from '@garita/shared';
import { Prisma } from '../../../generated/prisma/client';
import type { Env } from '../../../config/env';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { deriveTagKey, verifySun } from './crypto';
import {
  FACTORY_KEY,
  authContinue,
  authFirst,
  changeFileSettings,
  changeKey,
  checkFullResponse,
  finishAuth,
  writeNdef,
  type Ev2State,
} from './ev2';

const stateSchema = z.object({
  rndA: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional(),
  rndB: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional(),
  ti: z
    .string()
    .regex(/^[0-9a-f]{8}$/)
    .optional(),
  authKind: z.enum(['factory', 'derived']).default('factory'),
});
type SessionState = z.infer<typeof stateSchema>;

const STEPS = ['write_ndef', 'file_settings', 'key_1', 'key_2', 'key_3', 'key_4', 'key_0'] as const;

@Injectable()
export class SecureTagsService {
  private readonly logger = new Logger(SecureTagsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private keys() {
    const secret = this.config.get('NFC_MASTER_KEY', { infer: true });
    const version = this.config.get('NFC_MASTER_KEY_VERSION', { infer: true });
    if (!secret || version === undefined)
      throw new ServiceUnavailableException('La configuración segura no está disponible');
    return { master: Buffer.from(secret, 'hex'), version };
  }

  private keyFor(uid: string, slot: number, version: number): Buffer {
    return deriveTagKey(this.keys().master, Buffer.from(uid, 'hex'), slot, version);
  }

  async start(checkpointId: string, input: SecureTagStart, user: AuthenticatedUser) {
    const { version } = this.keys();
    const checkpoint = await this.prisma.tenantPrisma.checkpoint.findFirst({
      where: { id: checkpointId, status: 'active' },
    });
    if (!checkpoint) throw new NotFoundException('Recurso no encontrado');
    const versionBytes = Buffer.from(input.version, 'hex');
    if (
      versionBytes[0] !== 0x04 ||
      versionBytes[1] !== 0x04 ||
      versionBytes[7] !== 0x04 ||
      versionBytes[8] !== 0x04 ||
      versionBytes[14] !== 0x04
    )
      throw new BadRequestException('Modelo NFC no compatible');

    // Global UID probe prevents a tag from another tenant being claimed; no owner data is returned.
    const globalTag = await this.prisma.systemPrisma.nfcTag.findFirst({
      where: {
        uid: input.uid,
        OR: [{ status: 'active' }, { kind: 'secure' }, { configurationStatus: 'incomplete' }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (globalTag && globalTag.companyId !== user.companyId) {
      this.logger.warn({ event: 'secure_tag.cross_company_rejected', userId: user.userId });
      throw new UnprocessableEntityException('Etiqueta no disponible');
    }
    if (globalTag?.status === 'active' && globalTag.checkpointId !== checkpointId)
      throw new ConflictException('La etiqueta está asociada a otro punto');

    const retired = globalTag?.kind === 'secure' && globalTag.status === 'removed';
    const session = await this.prisma.tenantPrisma.secureTagSession.create({
      data: {
        id: randomUUID(),
        companyId: user.companyId,
        tagUid: input.uid,
        checkpointId,
        step: retired ? 'ready' : 'auth_1',
        state: { authKind: 'factory' },
        expiresAt: new Date(Date.now() + 2 * 60_000),
        createdById: user.userId,
      },
    });
    if (!retired) {
      if (globalTag) {
        await this.prisma.tenantPrisma.nfcTag.update({
          where: { id: globalTag.id },
          data: { configurationStatus: 'incomplete', masterKeyVersion: version },
        });
      } else {
        await this.prisma.tenantPrisma.nfcTag.create({
          data: {
            companyId: user.companyId,
            checkpointId,
            uid: input.uid,
            associatedById: user.userId,
            status: 'removed',
            configurationStatus: 'incomplete',
            masterKeyVersion: version,
          },
        });
      }
    }
    return { sessionId: session.id, apdu: retired ? null : authFirst(), complete: retired };
  }

  private async session(id: string, user: AuthenticatedUser) {
    const session = await this.prisma.tenantPrisma.secureTagSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Sesión no encontrada');
    if (session.createdById !== user.userId) throw new NotFoundException('Sesión no encontrada');
    if (session.expiresAt <= new Date())
      throw new ConflictException('Configuración vencida. Volvé a acercar el celular');
    return session;
  }

  async command(id: string, responseHex: string, user: AuthenticatedUser) {
    const session = await this.session(id, user);
    if (session.step === 'ready')
      throw new ConflictException('La configuración ya espera la lectura de prueba');
    const response = Buffer.from(responseHex, 'hex');
    const previous = stateSchema.parse(session.state ?? {});
    const authKey =
      previous.authKind === 'factory'
        ? FACTORY_KEY
        : this.keyFor(session.tagUid, 0, this.keys().version);
    let state: SessionState = previous;
    let step: string;
    let command: string | null;
    try {
      if (session.step === 'auth_1') {
        if (response.subarray(-2).toString('hex') !== '91af' && previous.authKind === 'factory') {
          step = 'auth_1';
          state = { authKind: 'derived' };
          command = authFirst();
        } else {
          const next = authContinue(response, authKey);
          state = { ...next.state, authKind: previous.authKind };
          step = 'auth_2';
          command = next.command;
        }
      } else if (session.step === 'auth_2') {
        if (!previous.rndA || !previous.rndB) throw new Error('Estado incompleto');
        state = {
          ...finishAuth(response, authKey, previous as Ev2State),
          authKind: previous.authKind,
        };
        if (previous.authKind === 'derived') {
          step = 'ready';
          command = null;
        } else {
          step = STEPS[0];
          command = writeNdef(0, state as Ev2State, authKey);
        }
      } else {
        const index = STEPS.indexOf(session.step as (typeof STEPS)[number]);
        if (index < 0) throw new Error('Paso no válido');
        checkFullResponse(response, index, state as Ev2State, authKey, session.step === 'key_0');
        if (index === STEPS.length - 1) {
          step = 'ready';
          command = null;
        } else {
          step = STEPS[index + 1];
          command = this.nextCommand(step, index + 1, state as Ev2State, authKey, session.tagUid);
        }
      }
    } catch {
      throw new BadRequestException(
        'La etiqueta no respondió correctamente. Volvé a acercar el celular',
      );
    }
    await this.prisma.tenantPrisma.secureTagSession.update({
      where: { id },
      data: { step, state: state as Prisma.InputJsonValue },
    });
    return { sessionId: id, apdu: command, complete: step === 'ready' };
  }

  private nextCommand(
    step: string,
    counter: number,
    state: Ev2State,
    authKey: Buffer,
    uid: string,
  ) {
    if (step === 'file_settings') return changeFileSettings(counter, state, authKey);
    const slot = Number(step.slice(-1));
    return changeKey(
      slot,
      this.keyFor(uid, slot, this.keys().version),
      this.keys().version,
      counter,
      state,
      authKey,
    );
  }

  async confirm(id: string, input: SecureTagConfirm, user: AuthenticatedUser) {
    const session = await this.session(id, user);
    if (session.step !== 'ready') throw new ConflictException('La configuración no se completó');
    const { version } = this.keys();
    const result = verifySun(
      input.sdmMessage,
      session.tagUid,
      this.keyFor(session.tagUid, 2, version),
      this.keyFor(session.tagUid, 1, version),
      null,
    );
    if (result.result !== 'valid')
      throw new UnprocessableEntityException('La lectura de prueba no es válida');
    const tag = await this.prisma.tenantPrisma.$transaction(async (tx) => {
      const previous = await tx.nfcTag.findFirst({
        where: { checkpointId: session.checkpointId, status: 'active' },
      });
      if (previous && previous.uid !== session.tagUid) {
        await tx.nfcTag.update({
          where: { id: previous.id },
          data: { status: 'replaced', endedAt: new Date(), endedById: user.userId },
        });
      }
      const candidate = await tx.nfcTag.findFirst({
        where: { uid: session.tagUid },
        orderBy: { createdAt: 'desc' },
      });
      if (!candidate) throw new NotFoundException('Etiqueta no encontrada');
      const updated = await tx.nfcTag.update({
        where: { id: candidate.id },
        data: {
          checkpointId: session.checkpointId,
          status: 'active',
          kind: 'secure',
          configurationStatus: 'configured',
          masterKeyVersion: version,
          lastCounter: result.counter,
          associatedById: user.userId,
          associatedAt: new Date(),
          endedAt: null,
          endedById: null,
        },
      });
      await tx.secureTagSession.delete({ where: { id } });
      return updated;
    });
    return { id: tag.id, status: tag.status, kind: tag.kind };
  }

  async reset(id: string) {
    const tag = await this.prisma.tenantPrisma.nfcTag.findFirst({
      where: { id, kind: 'secure', status: 'removed' },
    });
    if (!tag) throw new NotFoundException('Etiqueta no encontrada');
    await this.prisma.tenantPrisma.nfcTag.update({
      where: { id },
      data: { configurationStatus: 'incomplete' },
    });
    return { id, configurationStatus: 'incomplete' };
  }
}

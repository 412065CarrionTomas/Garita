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
  counter: z.number().int().min(0).default(0),
  resumeStep: z.enum(['key_1', 'key_2', 'key_3', 'key_4']).optional(),
  oldKeyKind: z.enum(['factory', 'derived']).default('factory'),
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
    const rawVersion: unknown = this.config.get('NFC_MASTER_KEY_VERSION', { infer: true });
    if (!secret || rawVersion === undefined)
      throw new ServiceUnavailableException('La configuración segura no está disponible');
    const version =
      typeof rawVersion === 'number'
        ? rawVersion
        : typeof rawVersion === 'string'
          ? parseInt(rawVersion, 10)
          : Number.NaN;
    if (Number.isNaN(version))
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

    if (globalTag?.masterKeyVersion != null && globalTag.masterKeyVersion !== version)
      throw new ConflictException(
        'La etiqueta usa otra versión de la clave maestra; requiere recuperar esa clave antes de reconfigurar',
      );
    const readyToConfirm =
      globalTag?.kind === 'secure' &&
      globalTag.configurationStatus === 'configured' &&
      globalTag.masterKeyVersion === version;
    const session = await this.prisma.tenantPrisma.secureTagSession.create({
      data: {
        id: randomUUID(),
        companyId: user.companyId,
        tagUid: input.uid,
        checkpointId,
        step: readyToConfirm ? 'ready' : 'auth_1',
        state: { authKind: 'factory' },
        expiresAt: new Date(Date.now() + 2 * 60_000),
        createdById: user.userId,
      },
    });
    if (!readyToConfirm) {
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
    return {
      sessionId: session.id,
      apdu: readyToConfirm ? null : authFirst(),
      complete: readyToConfirm,
    };
  }

  private async session(id: string, user: AuthenticatedUser) {
    const session = await this.prisma.tenantPrisma.secureTagSession.findFirst({ where: { id } });
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
        const next = authContinue(response, authKey);
        state = { ...previous, ...next.state, counter: 0 };
        step = 'auth_2';
        command = next.command;
      } else if (session.step === 'auth_2') {
        if (
          response.toString('hex') === '91ae' &&
          previous.authKind === 'factory' &&
          !previous.resumeStep
        ) {
          step = 'auth_1';
          state = { authKind: 'derived', oldKeyKind: 'factory', counter: 0 };
          command = authFirst();
        } else {
          if (!previous.rndA || !previous.rndB) throw new Error('Estado incompleto');
          state = {
            ...previous,
            ...finishAuth(response, authKey, previous as Ev2State),
            counter: 0,
          };
          step = previous.resumeStep ?? STEPS[0];
          command =
            step === 'write_ndef'
              ? writeNdef(0, state as Ev2State, authKey)
              : this.nextCommand(step, state, authKey, session.tagUid);
        }
      } else {
        const index = STEPS.indexOf(session.step as (typeof STEPS)[number]);
        if (index < 0) throw new Error('Paso no válido');
        if (
          response.toString('hex') === '911e' &&
          /^key_[1-4]$/.test(session.step) &&
          previous.oldKeyKind === 'factory'
        ) {
          // Un error de integridad invalida EV2: reautenticar antes de probar la clave anterior derivada.
          state = {
            authKind: previous.authKind,
            oldKeyKind: 'derived',
            counter: 0,
            resumeStep: session.step as SessionState['resumeStep'],
          };
          step = 'auth_1';
          command = authFirst();
        } else {
          checkFullResponse(
            response,
            previous.counter,
            state as Ev2State,
            authKey,
            session.step === 'key_0',
          );
          state = { ...previous, counter: previous.counter + 1, oldKeyKind: 'factory' };
          delete state.resumeStep;
          if (index === STEPS.length - 1) {
            step = 'ready';
            command = null;
          } else {
            const nextStep = STEPS[index + 1];
            if (!nextStep) throw new Error('Paso no válido');
            step = nextStep;
            command = this.nextCommand(step, state, authKey, session.tagUid);
          }
        }
      }
    } catch {
      throw new BadRequestException(
        'La etiqueta no respondió correctamente. Volvé a acercar el celular',
      );
    }
    await this.prisma.tenantPrisma.secureTagSession.updateMany({
      where: { id },
      data: { step, state: state as Prisma.InputJsonValue },
    });
    return { sessionId: id, apdu: command, complete: step === 'ready' };
  }

  private nextCommand(step: string, state: SessionState, authKey: Buffer, uid: string) {
    if (step === 'file_settings')
      return changeFileSettings(state.counter, state as Ev2State, authKey);
    const slot = Number(step.slice(-1));
    return changeKey(
      slot,
      this.keyFor(uid, slot, this.keys().version),
      this.keys().version,
      state.counter,
      state as Ev2State,
      authKey,
      state.oldKeyKind === 'derived' ? this.keyFor(uid, slot, this.keys().version) : FACTORY_KEY,
    );
  }

  async confirm(id: string, input: SecureTagConfirm, user: AuthenticatedUser) {
    const session = await this.session(id, user);
    if (session.step !== 'ready') throw new ConflictException('La configuración no se completó');
    const { version } = this.keys();
    const tag = await this.prisma.tenantPrisma.$transaction(async (tx) => {
      const candidate = await tx.nfcTag.findFirst({
        where: { uid: session.tagUid },
        orderBy: { createdAt: 'desc' },
      });
      if (!candidate) throw new NotFoundException('Etiqueta no encontrada');
      const result = verifySun(
        input.sdmMessage,
        session.tagUid,
        this.keyFor(session.tagUid, 2, version),
        this.keyFor(session.tagUid, 1, version),
        candidate.lastCounter,
      );
      if (result.result !== 'valid' || result.counter === undefined)
        throw new UnprocessableEntityException('La lectura de prueba no es válida');
      const previous = await tx.nfcTag.findFirst({
        where: { checkpointId: session.checkpointId, status: 'active' },
      });
      if (previous && previous.uid !== session.tagUid) {
        await tx.nfcTag.updateMany({
          where: { id: previous.id },
          data: { status: 'replaced', endedAt: new Date(), endedById: user.userId },
        });
      }
      const updated = await tx.nfcTag.updateMany({
        where: { id: candidate.id, lastCounter: candidate.lastCounter },
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
      if (updated.count !== 1)
        throw new ConflictException('La etiqueta cambió. Repetí la lectura de prueba');
      await tx.secureTagSession.deleteMany({ where: { id } });
      return candidate;
    });
    return { id: tag.id, status: 'active', kind: 'secure' };
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

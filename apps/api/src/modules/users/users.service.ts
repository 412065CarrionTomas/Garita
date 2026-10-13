import {
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { CreateUserRequest, UpdateUserRequest } from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantResourceService } from '../auth/tenant-resource.service';
import { FIREBASE_IDENTITY_PROVIDER } from '../auth/auth.types';
import type { FirebaseIdentityProvider } from '../auth/auth.types';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { ResendInvitationMailer } from './email.service';
import { purgeExpiredRedeemAttempts } from './redeem-attempts';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: TenantResourceService,
    @Inject(FIREBASE_IDENTITY_PROVIDER) private readonly firebase: FirebaseIdentityProvider,
    private readonly mailer: ResendInvitationMailer,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async list(query: {
    rol?: 'supervisor' | 'guard';
    estado?: 'invitation_pending' | 'active' | 'deactivated';
    pagina: number;
  }) {
    const roleFilter: 'supervisor' | 'guard' | { in: ('supervisor' | 'guard')[] } = query.rol ?? {
      in: ['supervisor', 'guard'],
    };
    const where = { role: roleFilter, status: query.estado };
    const [total, users] = await Promise.all([
      this.prisma.tenantPrisma.user.count({ where }),
      this.prisma.tenantPrisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.pagina - 1) * 20,
        take: 20,
        include: { invitations: { orderBy: { createdAt: 'desc' }, take: 1 } },
      }),
    ]);
    return {
      items: users.map((user) => this.present(user)),
      pagina: query.pagina,
      total,
      paginas: Math.ceil(total / 20),
    };
  }

  async detail(id: string) {
    await this.getUser(id);
    const user = await this.prisma.tenantPrisma.user.findUniqueOrThrow({
      where: { id },
      include: { invitations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return this.present(user);
  }

  async create(input: CreateUserRequest, adminId: string, companyId: string) {
    // Email uniqueness spans companies, so this is a justified system-level lookup.
    if (await this.prisma.systemPrisma.user.findUnique({ where: { email: input.email } }))
      throw new ConflictException('Ese correo ya está en uso');
    let identity: { uid: string };
    try {
      identity = await this.firebase.createDisabledUser(input.email);
    } catch (error) {
      if ((error as { code?: string }).code === 'auth/email-already-exists')
        throw new ConflictException('Ese correo ya está en uso');
      throw error;
    }
    const token = randomBytes(32).toString('base64url');
    const user = await this.prisma.tenantPrisma.user
      .create({
        data: {
          firebaseUid: identity.uid,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          employeeNumber: input.employeeNumber,
          role: input.role,
          status: 'invitation_pending',
          companyId,
          invitations: {
            create: {
              tokenHash: hash(token),
              expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
            },
          },
        },
        include: { invitations: { orderBy: { createdAt: 'desc' }, take: 1 } },
      })
      .catch(async (error: unknown) => {
        // Compensación: evita dejar un usuario huérfano en Firebase si falla la BD.
        await this.firebase.deleteUser(identity.uid).catch((cleanupError: unknown) => {
          this.logger.error({
            event: 'personnel_firebase_cleanup_failed',
            firebaseUid: identity.uid,
            error: cleanupError instanceof Error ? cleanupError.message : 'unknown',
          });
        });
        throw error;
      });
    const invitation = user.invitations[0];
    if (!invitation) throw new Error('No se pudo crear la invitación del usuario');
    await this.send(invitation.id, input.firstName, input.email, token);
    this.logger.log({ event: 'personnel_created', adminId, userId: user.id });
    return this.detail(user.id);
  }

  async update(id: string, input: UpdateUserRequest, adminId: string) {
    await this.getUser(id);
    const result = await this.prisma.tenantPrisma.user.update({ where: { id }, data: input });
    this.logger.log({ event: 'personnel_updated', adminId, userId: result.id });
    return this.detail(id);
  }

  async deactivate(id: string, adminId: string) {
    const user = await this.getUser(id);
    await this.firebase.setDisabled(user.firebaseUid, true);
    await this.firebase.revokeRefreshTokens(user.firebaseUid);
    await this.prisma.tenantPrisma.user.update({ where: { id }, data: { status: 'deactivated' } });
    await this.prisma.tenantPrisma.invitation.updateMany({
      where: { userId: id, usedAt: null, replacedAt: null },
      data: { replacedAt: new Date() },
    });
    this.logger.log({ event: 'personnel_deactivated', adminId, userId: id });
    return { ok: true as const };
  }

  async reactivate(id: string, adminId: string) {
    const user = await this.getUser(id);
    await this.firebase.setDisabled(user.firebaseUid, false);
    await this.prisma.tenantPrisma.user.update({ where: { id }, data: { status: 'active' } });
    this.logger.log({ event: 'personnel_reactivated', adminId, userId: id });
    return { ok: true as const };
  }

  async resend(id: string, adminId: string) {
    const user = await this.getUser(id);
    if (user.status === 'deactivated')
      throw new ConflictException(
        'El usuario está desactivado. Reactivalo antes de reenviar la invitación',
      );
    await this.prisma.tenantPrisma.invitation.updateMany({
      where: { userId: id, usedAt: null, replacedAt: null },
      data: { replacedAt: new Date() },
    });
    const token = randomBytes(32).toString('base64url');
    const invite = await this.prisma.tenantPrisma.invitation.create({
      data: {
        userId: id,
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      },
    });
    await this.send(invite.id, user.firstName, user.email, token);
    this.logger.log({ event: 'personnel_invitation_resent', adminId, userId: id });
    return this.detail(id);
  }

  async redeem(token: string, ip: string) {
    purgeExpiredRedeemAttempts(redeemAttempts);
    const key = `${ip}:${Math.floor(Date.now() / 60000)}`;
    const attempts = (redeemAttempts.get(key) ?? 0) + 1;
    redeemAttempts.set(key, attempts);
    if (attempts > 10)
      throw new HttpException(
        {
          message: 'Demasiados intentos. Probá más tarde.',
          reason: 'rate_limited',
        },
        429,
      );
    const invitation = await this.prisma.systemPrisma.invitation.findUnique({
      where: { tokenHash: hash(token) },
      include: { user: true },
    });
    if (!invitation) throw new GoneException({ message: 'Invitación inválida', reason: 'invalid' });
    if (invitation.replacedAt)
      throw new GoneException({
        message:
          'Esta invitación fue reemplazada. Pedile a tu administrador que te envíe una nueva',
        reason: 'replaced',
      });
    if (invitation.usedAt)
      throw new GoneException({ message: 'Esta invitación ya fue usada', reason: 'used' });
    if (invitation.expiresAt <= new Date())
      throw new GoneException({
        message: 'Esta invitación venció. Pedile a tu administrador que te envíe una nueva',
        reason: 'expired',
      });
    if (invitation.user.status === 'deactivated')
      throw new GoneException({ message: 'Invitación inválida', reason: 'invalid' });
    await this.firebase.setDisabled(invitation.user.firebaseUid, false);
    return {
      passwordSetupUrl: await this.firebase.generatePasswordResetLink(invitation.user.email),
      role: invitation.user.role as 'supervisor' | 'guard',
    };
  }

  async markUsed(userId: string) {
    await this.prisma.tenantPrisma.invitation.updateMany({
      where: { userId, usedAt: null, replacedAt: null },
      data: { usedAt: new Date() },
    });
  }

  private async send(invitationId: string, name: string, email: string, token: string) {
    const url = new URL('/activar', this.config.get('WEB_APP_URL', { infer: true }));
    url.searchParams.set('token', token);
    try {
      const result = await this.mailer.sendInvitation({ name, email, link: url.toString() });
      await this.prisma.tenantPrisma.invitation.update({
        where: { id: invitationId },
        data: { sendStatus: 'sent', providerMessageId: result.id },
      });
    } catch (error) {
      await this.prisma.tenantPrisma.invitation.update({
        where: { id: invitationId },
        data: { sendStatus: 'failed' },
      });
      this.logger.error({
        event: 'invitation_email',
        invitationId,
        result: 'failed',
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  private async getUser(id: string) {
    await this.resources.findOwnedOrThrow('User', id);
    const user = await this.prisma.tenantPrisma.user.findUniqueOrThrow({ where: { id } });
    if (user.role !== 'supervisor' && user.role !== 'guard')
      throw new NotFoundException('Recurso no encontrado');
    return user;
  }

  private present(user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    employeeNumber: string | null;
    role: 'admin' | 'supervisor' | 'guard' | 'client';
    status: 'invitation_pending' | 'active' | 'deactivated';
    invitations?: { sendStatus: 'pending' | 'sent' | 'failed' }[];
  }) {
    if (user.role !== 'supervisor' && user.role !== 'guard')
      throw new NotFoundException('Recurso no encontrado');
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      employeeNumber: user.employeeNumber,
      role: user.role,
      status: user.status,
      invitationStatus: user.invitations?.[0]?.sendStatus ?? null,
    };
  }
}

const redeemAttempts = new Map<string, number>();
function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

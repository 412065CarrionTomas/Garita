import { createAdapter } from '@socket.io/redis-adapter';
import { Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Env } from '../../config/env';
import Redis from 'ioredis';
import type { DefaultEventsMap, Namespace, Socket } from 'socket.io';
import { SOCKET_NAMESPACE } from '@garita/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FIREBASE_IDENTITY_PROVIDER } from '../auth/auth.types';
import type { FirebaseIdentityProvider } from '../auth/auth.types';

interface SupervisionSocketData {
  userId?: string;
  companyId?: string;
}
type SupervisionSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SupervisionSocketData
>;
type SupervisionNamespace = Namespace<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SupervisionSocketData
>;
const handshakeSchema = z.object({ token: z.string().trim().min(1) });

@WebSocketGateway({ namespace: SOCKET_NAMESPACE })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private refreshTimer?: ReturnType<typeof setInterval>;
  private publisher?: Redis;
  private subscriber?: Redis;

  @WebSocketServer() server!: SupervisionNamespace;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(FIREBASE_IDENTITY_PROVIDER) private readonly identity: FirebaseIdentityProvider,
  ) {}

  async afterInit(server: SupervisionNamespace): Promise<void> {
    server.on('connection', (socket) => {
      this.logger.debug({ event: 'realtime.connected', activeConnections: server.sockets.size });
      socket.once('disconnect', () => {
        this.logger.debug({
          event: 'realtime.disconnected',
          activeConnections: server.sockets.size,
        });
      });
    });
    if (this.config.get('SOCKET_REDIS_ADAPTER_ENABLED', { infer: true })) {
      const url = this.config.getOrThrow('REDIS_URL', { infer: true });
      this.publisher = new Redis(url);
      this.subscriber = this.publisher.duplicate();
      this.publisher.on('error', (error) => {
        this.logger.error(error.message);
      });
      this.subscriber.on('error', (error) => {
        this.logger.error(error.message);
      });
      await Promise.all([
        this.waitUntilReady(this.publisher),
        this.waitUntilReady(this.subscriber),
      ]);
      server.adapter = createAdapter(this.publisher, this.subscriber)(server);
    }
    // shortcut: assignment changes reach rooms within 60 seconds; emit an assignment event to remove this polling delay if that becomes too slow.
    this.refreshTimer = setInterval(() => {
      for (const socket of server.sockets.values())
        void this.refreshRooms(socket).catch((error: unknown) => {
          this.logger.error(
            error instanceof Error ? error.message : 'No se actualizaron las rooms',
          );
        });
    }, 60_000);
  }

  async handleConnection(socket: SupervisionSocket): Promise<void> {
    const handshake = handshakeSchema.safeParse(socket.handshake.auth);
    if (!handshake.success) {
      socket.disconnect(true);
      return;
    }
    try {
      const { uid } = await this.identity.verifyIdToken(handshake.data.token);
      // systemPrisma resolves the tenant for an authenticated socket handshake outside HTTP request scope.
      this.logger.debug({ event: 'realtime.authenticated_socket' });
      const user = await this.prisma.systemPrisma.user.findUnique({
        where: { firebaseUid: uid },
        select: { id: true, companyId: true, role: true, status: true },
      });
      if (user?.status !== 'active' || !['admin', 'supervisor'].includes(user.role)) {
        socket.disconnect(true);
        return;
      }
      socket.data.userId = user.id;
      socket.data.companyId = user.companyId;
      await this.refreshRooms(socket);
    } catch {
      socket.disconnect(true);
    }
  }

  async refreshRooms(socket: SupervisionSocket): Promise<void> {
    const { companyId, userId } = socket.data;
    if (!companyId || !userId) return;
    // systemPrisma is needed to refresh site rooms without an HTTP tenant context.
    const user = await this.prisma.systemPrisma.user.findUnique({
      where: { id: userId },
      select: { role: true, status: true },
    });
    if (user?.status !== 'active' || !['admin', 'supervisor'].includes(user.role)) {
      socket.disconnect(true);
      return;
    }
    const sites = await this.prisma.systemPrisma.site.findMany({
      where: {
        companyId,
        ...(user.role === 'supervisor' ? { supervisors: { some: { userId } } } : {}),
      },
      select: { id: true },
    });
    const nextRooms = new Set(sites.map(({ id }) => `site:${id}`));
    for (const room of socket.rooms) {
      if (room.startsWith('site:') && !nextRooms.has(room)) await socket.leave(room);
    }
    for (const room of nextRooms) await socket.join(room);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    const clients = [this.publisher, this.subscriber].filter(
      (client): client is Redis => client !== undefined,
    );
    await Promise.all(clients.map((client) => client.quit()));
  }

  private async waitUntilReady(client: Redis): Promise<void> {
    if (client.status === 'ready') return;
    await new Promise<void>((resolve, reject) => {
      client.once('ready', resolve);
      client.once('error', reject);
    });
  }
}

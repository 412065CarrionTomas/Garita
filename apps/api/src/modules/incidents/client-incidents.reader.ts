import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClientIncidentsReader {
  private readonly logger = new Logger(ClientIncidentsReader.name);
  constructor(private readonly prisma: PrismaService) {}

  // TODO(HU-28): expose this reader through the client portal after its route and permissions exist.
  async list(user: AuthenticatedUser) {
    if (user.role !== 'client' || !user.clientId) throw new ForbiddenException();
    // systemPrisma is required until HU-28 registers a client tenant policy for Incident; every filter is explicit.
    const incidents = await this.prisma.systemPrisma.incident.findMany({
      where: {
        companyId: user.companyId,
        classificationStatus: 'client_visible',
        site: { clientId: user.clientId, status: 'active', client: { status: 'active' } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 25,
      select: {
        id: true,
        type: true,
        description: true,
        createdAt: true,
        site: { select: { name: true } },
        classifications: {
          orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { clientNote: true },
        },
      },
    });
    this.logger.log({
      event: 'incident.client_read',
      companyId: user.companyId,
      clientId: user.clientId,
    });
    return incidents.map(({ classifications, ...incident }) => ({
      ...incident,
      clientNote: classifications[0]?.clientNote ?? null,
    }));
  }
}

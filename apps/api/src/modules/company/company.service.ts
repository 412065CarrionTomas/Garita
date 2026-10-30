import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}
  get(id: string) {
    return this.prisma.tenantPrisma.company.findUniqueOrThrow({
      where: { id },
      select: { guardPhone: true },
    });
  }
  update(id: string, guardPhone: string | null) {
    return this.prisma.tenantPrisma.company.update({
      where: { id },
      data: { guardPhone },
      select: { guardPhone: true },
    });
  }
}

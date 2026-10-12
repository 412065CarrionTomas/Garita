import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth.types';
import { TenantContext } from './tenant-context';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(private readonly tenantContext: TenantContext) {}

  use(request: AuthenticatedRequest, response: Response, next: NextFunction): void {
    request.correlationId = randomUUID();
    response.setHeader('x-correlation-id', request.correlationId);
    this.tenantContext.run(
      { correlationId: request.correlationId, method: request.method, path: request.originalUrl },
      next,
    );
  }
}

import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth.types';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: AuthenticatedRequest, response: Response, next: NextFunction): void {
    request.correlationId = randomUUID();
    response.setHeader('x-correlation-id', request.correlationId);
    next();
  }
}

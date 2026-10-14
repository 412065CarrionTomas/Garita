import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { SyncRequest } from './shift-credential.guard';
import type { ShiftCredentialPayload } from './shift-credential.service';

export const CurrentShiftCredential = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ShiftCredentialPayload => {
    const request = context.switchToHttp().getRequest<SyncRequest>();
    return request.shiftCredential;
  },
);

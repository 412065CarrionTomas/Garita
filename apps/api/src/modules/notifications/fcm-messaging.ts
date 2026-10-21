import { Injectable } from '@nestjs/common';
import { getMessaging } from 'firebase-admin/messaging';
import type { MulticastMessage, BatchResponse } from 'firebase-admin/messaging';

@Injectable()
export class FcmMessaging {
  sendEachForMulticast(message: MulticastMessage): Promise<BatchResponse> {
    return getMessaging().sendEachForMulticast(message);
  }
}

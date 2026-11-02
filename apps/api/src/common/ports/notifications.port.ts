import { Injectable, Logger } from '@nestjs/common';
import type { NotificationKind, NotificationPayload } from '@garita/shared';

export type NotificationPriority = 'normal' | 'high';

export interface NotificationsPort {
  /** Active supervisors assigned to the site and the company's administrators. */
  notifySiteStaff(input: {
    companyId: string;
    siteId: string;
    excludeUserIds?: string[];
    kind: NotificationKind;
    payload: NotificationPayload;
    priority?: NotificationPriority;
  }): Promise<void>;
  notifyUsers(input: {
    companyId: string;
    userIds: string[];
    kind: NotificationKind;
    payload: NotificationPayload;
    priority?: NotificationPriority;
  }): Promise<void>;
}

export const NOTIFICATIONS_PORT = Symbol('NOTIFICATIONS_PORT');

/** HU-18 replaces this provider in PortsModule. Never logs the payload. */
@Injectable()
export class NoopNotifications implements NotificationsPort {
  private readonly logger = new Logger(NoopNotifications.name);

  notifySiteStaff(input: { kind: NotificationKind; excludeUserIds?: string[] }): Promise<void> {
    this.logger.debug(`notifySiteStaff ${input.kind}`);
    return Promise.resolve();
  }

  notifyUsers(input: { kind: NotificationKind }): Promise<void> {
    this.logger.debug(`notifyUsers ${input.kind}`);
    return Promise.resolve();
  }
}

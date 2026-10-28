import { Injectable, Logger } from '@nestjs/common';
import type { NoticeKind, NoticeResolution } from '@garita/shared';

export interface RaiseNoticeInput {
  companyId: string;
  siteId: string;
  kind: NoticeKind;
  /** Window, assignment or shift the notice is about; with `kind` it is the idempotency key (`noticeKey`). */
  subjectId: string;
  shiftId: string;
  /** Extra data shown in the panel (missing points, close reason, received time). Never names or addresses. */
  details?: Record<string, string | number | boolean | null | string[]>;
}

export interface NoticesPort {
  /** Creates the notice once per key and delivers it; a repeated key is a no-op. */
  raise(input: RaiseNoticeInput): Promise<void>;
  /** Resolves the open notice of that key, if any. */
  resolve(input: {
    companyId: string;
    kind: NoticeKind;
    subjectId: string;
    resolution: NoticeResolution;
  }): Promise<void>;
}

export const NOTICES_PORT = Symbol('NOTICES_PORT');

/** HU-17 replaces this provider in PortsModule with the notices module. */
@Injectable()
export class NoopNotices implements NoticesPort {
  private readonly logger = new Logger(NoopNotices.name);

  raise(input: { kind: NoticeKind }): Promise<void> {
    this.logger.debug(`raise ${input.kind}`);
    return Promise.resolve();
  }

  resolve(input: { kind: NoticeKind }): Promise<void> {
    this.logger.debug(`resolve ${input.kind}`);
    return Promise.resolve();
  }
}

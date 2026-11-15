import { Injectable } from '@nestjs/common';
import type { AccountStatus, SuspensionReason } from '@garita/shared';

export interface AccountState {
  status: AccountStatus;
  suspensionReason: SuspensionReason | null;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
  /** Null means no limit applies. */
  guardLimit: number | null;
}

export interface AccountStatePort {
  get(companyId: string): Promise<AccountState>;
  /**
   * Rejects with a 409 (`GUARD_LIMIT_REACHED_CODE`) when one more guard, active or with a
   * pending invitation, would exceed the limit. Called on guard creation and reactivation.
   */
  assertGuardSlot(companyId: string): Promise<void>;
  /** Idempotent: moving to the current state is a no-op. `reason` only with `suspended`. */
  transition(input: {
    companyId: string;
    to: AccountStatus;
    reason?: SuspensionReason;
    graceEndsAt?: Date;
  }): Promise<void>;
}

export const ACCOUNT_STATE_PORT = Symbol('ACCOUNT_STATE_PORT');

/** HU-41 replaces this provider in PortsModule with the account module. */
@Injectable()
export class NoopAccountState implements AccountStatePort {
  get(): Promise<AccountState> {
    return Promise.resolve({
      status: 'active',
      suspensionReason: null,
      trialEndsAt: null,
      graceEndsAt: null,
      guardLimit: null,
    });
  }

  assertGuardSlot(): Promise<void> {
    return Promise.resolve();
  }

  transition(): Promise<void> {
    return Promise.resolve();
  }
}

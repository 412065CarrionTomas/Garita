import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthenticatedUser } from './auth.types';

export interface TenantRequestContext {
  correlationId: string;
  method?: string;
  path?: string;
  user?: AuthenticatedUser;
}

@Injectable()
export class TenantContext {
  private readonly storage = new AsyncLocalStorage<TenantRequestContext>();

  run<T>(context: TenantRequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  get current(): TenantRequestContext | undefined {
    return this.storage.getStore();
  }

  get user(): AuthenticatedUser | undefined {
    return this.storage.getStore()?.user;
  }

  setUser(user: AuthenticatedUser): void {
    const context = this.storage.getStore();
    if (context) context.user = user;
  }
}

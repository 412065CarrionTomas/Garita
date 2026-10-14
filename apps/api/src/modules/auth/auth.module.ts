import { forwardRef, MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { SyncModule } from '../sync/sync.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { FIREBASE_IDENTITY_PROVIDER } from './auth.types';
import { FirebaseAdminIdentityProvider } from './firebase-identity.provider';
import { RequestIdMiddleware } from './request-id.middleware';
import { TenantResourceService } from './tenant-resource.service';

@Module({
  imports: [PrismaModule, forwardRef(() => SyncModule)],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    FirebaseAdminIdentityProvider,
    RequestIdMiddleware,
    TenantResourceService,
    { provide: FIREBASE_IDENTITY_PROVIDER, useExisting: FirebaseAdminIdentityProvider },
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
  exports: [TenantResourceService, FIREBASE_IDENTITY_PROVIDER],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}

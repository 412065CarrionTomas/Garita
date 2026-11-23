import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RouteBuilder } from './route-builder';
import { RouteCache } from './route-cache';
import { RoutePreviewRateLimit } from './route-preview-rate-limit';
import { ROUTING_PORT, routingProvider } from './routing.port';

@Module({
  providers: [
    RouteCache,
    RouteBuilder,
    RoutePreviewRateLimit,
    { provide: ROUTING_PORT, inject: [ConfigService, RouteCache], useFactory: routingProvider },
  ],
  exports: [RouteBuilder, RoutePreviewRateLimit],
})
export class RoutingModule {}

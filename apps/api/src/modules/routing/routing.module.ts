import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RouteCache } from './route-cache';
import { ROUTING_PORT, routingProvider } from './routing.port';

@Module({
  providers: [
    RouteCache,
    { provide: ROUTING_PORT, inject: [ConfigService, RouteCache], useFactory: routingProvider },
  ],
  exports: [ROUTING_PORT],
})
export class RoutingModule {}

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RouteBuilder } from './route-builder';
import { RouteCache } from './route-cache';
import { ROUTING_PORT, routingProvider } from './routing.port';

@Module({
  providers: [
    RouteCache,
    RouteBuilder,
    { provide: ROUTING_PORT, inject: [ConfigService, RouteCache], useFactory: routingProvider },
  ],
  exports: [RouteBuilder],
})
export class RoutingModule {}

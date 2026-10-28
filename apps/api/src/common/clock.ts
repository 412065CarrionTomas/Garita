import { Global, Injectable, Module } from '@nestjs/common';

export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

@Global()
@Module({ providers: [{ provide: CLOCK, useClass: SystemClock }], exports: [CLOCK] })
export class ClockModule {}

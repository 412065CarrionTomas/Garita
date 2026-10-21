import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DevicesController } from './devices.controller';
import { FcmMessaging } from './fcm-messaging';
import { NotificationsProcessor } from './notifications.processor';
import { NOTIFICATIONS_QUEUE } from './notifications.constants';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [PrismaModule, BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })],
  controllers: [DevicesController],
  providers: [NotificationsService, NotificationsProcessor, FcmMessaging],
  exports: [NotificationsService],
})
export class NotificationsModule {}

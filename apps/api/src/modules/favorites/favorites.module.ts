import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';
import {
  FAVORITE_VISIBILITY_PORT,
  PrismaFavoriteVisibilityAdapter,
} from './favorites-visibility.port';

@Module({
  imports: [PrismaModule],
  controllers: [FavoritesController],
  providers: [
    FavoritesService,
    { provide: FAVORITE_VISIBILITY_PORT, useClass: PrismaFavoriteVisibilityAdapter },
  ],
})
export class FavoritesModule {}

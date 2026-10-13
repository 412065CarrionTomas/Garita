import type { INestApplication } from '@nestjs/common';
import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import type { Env } from './config/env';

/**
 * Configuración HTTP común a la aplicación real y a los tests de integración,
 * para que ambos expongan exactamente las mismas rutas y cabeceras.
 */
export function setupApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.use(helmet());
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }) });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Garita API').setVersion('1').addBearerAuth().build(),
  );
  SwaggerModule.setup('docs', app, document, { useGlobalPrefix: true });
}

import { Test } from '@nestjs/testing';
import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/core/prisma/prisma.service';

// Mirrors the request pipeline wired in src/main.ts (validation, serialization,
// cookie parsing, helmet, CORS) minus dev-only wiring (Swagger, Bull Board) and
// infra not needed for these HTTP-level assertions (sessions, CSRF).
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();

  app.enableCors({ origin: true, credentials: true });
  app.use(helmet());
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  await app.init();
  return app;
}

export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

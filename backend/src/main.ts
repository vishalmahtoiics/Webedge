import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { loadConfig } from './config/env';

async function bootstrap(): Promise<void> {
  // Throws and exits if anything required is missing or weak.
  const config = loadConfig();

  const app = await NestFactory.create(AppModule, { bodyParser: true });

  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');

  // Trust exactly one proxy hop (nginx). Without this, X-Forwarded-For is
  // attacker-controlled and per-IP rate limits can be bypassed by spoofing it.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validateCustomDecorators: true,
    }),
  );

  app.enableCors({
    origin: [config.CLIENT_ORIGIN, config.ADMIN_ORIGIN],
    credentials: true,
  });

  await app.listen(config.PORT);
}

void bootstrap();

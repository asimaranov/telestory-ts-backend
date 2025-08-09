import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { RegularNodeModule } from './src/regular-node-api/regular-node.module.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as basicAuth from 'express-basic-auth';

async function bootstrap() {

  const app = await NestFactory.create(RegularNodeModule);

  if (process.env.NODE_ENV !== 'development') {
    app.use(
      ['/api'],
      basicAuth({
        challenge: true,
        // this is the username and password used to authenticate
        users: { admin: 'WvVjPsyZ' },
        unauthorizedResponse: {
          message: 'Unauthorized',
        },
      }),
    );
  }
  
  const config = new DocumentBuilder()
  .setTitle('Regular Node API')
  .setDescription('Regular Node API')
  .setVersion('1.0')
  .addTag('regular-node')
  .build();

  app.enableCors();

  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, documentFactory);

  await app.listen(12390);
}
bootstrap();

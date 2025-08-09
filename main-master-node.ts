import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { MasterNodeModule } from './src/master-node-api/master-node.module.js';

async function bootstrap() {
  const app = await NestFactory.create(MasterNodeModule);
  app.enableCors();
  await app.listen(12389);
}
bootstrap();

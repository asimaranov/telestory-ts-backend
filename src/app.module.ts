import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ServerInfoModule } from './server-info/server-info.module';

@Module({
  imports: [ServerInfoModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

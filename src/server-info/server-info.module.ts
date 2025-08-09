import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ServerInfoController } from './server-info.controller';
import { ServerInfoService } from './server-info.service';

@Module({
  imports: [HttpModule],
  controllers: [ServerInfoController],
  providers: [ServerInfoService],
  exports: [ServerInfoService],
})
export class ServerInfoModule {}
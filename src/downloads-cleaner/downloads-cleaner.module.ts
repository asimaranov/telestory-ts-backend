import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DownloadsCleanerService } from './downloads-cleaner.service';
import { DownloadsCleanerController } from './downloads-cleaner.controller';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [DownloadsCleanerController],
  providers: [DownloadsCleanerService],
  exports: [DownloadsCleanerService],
})
export class DownloadsCleanerModule {}

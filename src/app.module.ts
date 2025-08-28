import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ServerInfoModule } from './server-info/server-info.module';
import { DownloaderServiceModule } from './downloader/downloader.module';
import { DownloadsCleanerModule } from './downloads-cleaner/downloads-cleaner.module';
import { HttpModule } from '@nestjs/axios';
import { NodesModule } from './nodes/nodes.module';
import { NodeStatsModule } from './node-stats/node-stats.module';
import { AccountsModule } from './accounts/accounts.module';

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI!),
    ServerInfoModule,
    DownloaderServiceModule,
    DownloadsCleanerModule,
    HttpModule.registerAsync({
      useFactory: () => ({
        timeout: 10000,
        maxRedirects: 5,
      }),
    }),
    NodesModule,
    NodeStatsModule,
    AccountsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

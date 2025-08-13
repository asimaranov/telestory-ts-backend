import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AccountsModule } from '../accounts/accounts.module.js';
import { NodesModule } from '../nodes/nodes.module.js';
import { DownloadsStatsModule } from '../downloads-stats/downloads-stats.module.js';
import { RegularNodeAccountsController } from '../accounts/regular-node/accounts.controller.js';
import { DownloaderServiceModule } from '../downloader/downloader.module.js';
import { DownloaderController } from '../downloader/downloader.controller.js';
import { ServerInfoModule } from '../server-info/server-info.module.js';
import { AppController } from '../app.controller.js';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'downloads'),
      serveRoot: '/downloads',
      serveStaticOptions: {
        index: false,
        fallthrough: false,
      },
    }),
    AccountsModule,
    NodesModule,
    DownloadsStatsModule,
    DownloaderServiceModule,
    ServerInfoModule,
    MongooseModule.forRoot(process.env.MONGODB_URI!),
  ],
  controllers: [AppController, RegularNodeAccountsController, DownloaderController],
  providers: [],
})
export class RegularNodeModule {}

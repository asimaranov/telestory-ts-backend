import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AccountsModule } from '../accounts/accounts.module.js';
import { NodesModule } from '../nodes/nodes.module.js';
import { DownloadsStatsModule } from '../downloads-stats/downloads-stats.module.js';
import { NodeStatsModule } from '../node-stats/node-stats.module.js';

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
    NodeStatsModule,
    MongooseModule.forRoot(process.env.MONGODB_URI!),
  ],
  controllers: [],
  providers: [],
})
export class MasterNodeModule {}

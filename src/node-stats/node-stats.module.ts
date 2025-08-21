import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';

import { NodeStatsController } from './node-stats.controller.js';
import { NodeStatsService } from './node-stats.service.js';
import { NodesModule } from '../nodes/nodes.module.js';
import { DownloadsStatsModule } from '../downloads-stats/downloads-stats.module.js';
import {
  TelestoryAccountData,
  TelestoryAccountDataSchema,
} from '../accounts/schema/telestory-account.schema.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TelestoryAccountData.name, schema: TelestoryAccountDataSchema },
    ]),
    HttpModule.registerAsync({
      useFactory: () => ({
        timeout: 10000,
        maxRedirects: 5,
      }),
    }),
    NodesModule,
    DownloadsStatsModule,
  ],
  controllers: [NodeStatsController],
  providers: [NodeStatsService],
  exports: [NodeStatsService],
})
export class NodeStatsModule {}

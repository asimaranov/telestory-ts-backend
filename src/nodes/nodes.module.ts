import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TelestoryNodeData,
  TelestoryNodeDataSchema,
} from './schema/nodes-api.schema.js';
import { TelestoryNodesService } from './nodes.service.js';
import { DownloadsStatsService } from '@/downloads-stats/downloads-stats.service.js';
import { HttpModule } from '@nestjs/axios';
import { AccountsModule } from '../accounts/accounts.module.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TelestoryNodeData.name, schema: TelestoryNodeDataSchema },
    ]),
    HttpModule.registerAsync({
      useFactory: () => ({
        timeout: 5000,
        maxRedirects: 5,
      }),
    }),
  ],
  controllers: [],
  providers: [TelestoryNodesService],
  exports: [TelestoryNodesService],
})
export class NodesModule {}

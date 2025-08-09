import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DownloadsStatsData,
  DownloadsStatsDataSchema,
} from './schema/downloads-stats.schema.js';
import { DownloadsStatsService } from './downloads-stats.service.js';
import { TelestoryNodesService } from '../nodes/nodes.service.js';
import { NodesModule } from '../nodes/nodes.module.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DownloadsStatsData.name, schema: DownloadsStatsDataSchema },
    ]),
    NodesModule,
  ],
  providers: [DownloadsStatsService],
  exports: [DownloadsStatsService],
})
export class DownloadsStatsModule {}

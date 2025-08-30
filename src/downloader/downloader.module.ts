import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DownloaderService } from './downloader.service.js';
import { TelestoryNodesService } from '../nodes/nodes.service.js';
import { NodesModule } from '../nodes/nodes.module.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import {
  InvalidUsernamesData,
  InvalidUsernamesDataSchema,
  StoriesCacheData,
  StoriesCacheDataSchema,
} from './schema/downloader.schema.js';
import {
  TelestoryAccountData,
  TelestoryAccountDataSchema,
} from '../accounts/schema/telestory-account.schema.js';
import { DownloadsStatsModule } from '../downloads-stats/downloads-stats.module.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InvalidUsernamesData.name, schema: InvalidUsernamesDataSchema },
      { name: TelestoryAccountData.name, schema: TelestoryAccountDataSchema },
      { name: StoriesCacheData.name, schema: StoriesCacheDataSchema },
    ]),
    NodesModule,
    AccountsModule,
    DownloadsStatsModule,
  ],
  providers: [DownloaderService],
  exports: [DownloaderService],
})
export class DownloaderServiceModule {}

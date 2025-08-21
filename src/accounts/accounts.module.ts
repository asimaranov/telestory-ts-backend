import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  TelestoryAccountData,
  TelestoryAccountDataSchema,
} from './schema/telestory-account.schema.js';
import { NodesModule } from '../nodes/nodes.module.js';
import { TelestoryAccountsService } from './regular-node/telestory-accounts.service.js';
import {
  TelestoryPendingAccountData,
  TelestoryPendingAccountDataSchema,
} from './schema/telestory-pending-account.schema.js';
import { NodeStatsModule } from '../node-stats/node-stats.module.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TelestoryAccountData.name, schema: TelestoryAccountDataSchema },
      {
        name: TelestoryPendingAccountData.name,
        schema: TelestoryPendingAccountDataSchema,
      },
    ]),
    NodesModule,
    forwardRef(() => NodeStatsModule),
  ],
  providers: [TelestoryAccountsService],
  exports: [TelestoryAccountsService],
})
export class AccountsModule {}

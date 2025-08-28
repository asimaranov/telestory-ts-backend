import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AccountBanDocument = BaseAccountBanDocument & Document;

export class BaseAccountBanDocument extends Document {
  @Prop({
    type: String,
    required: true,
  })
  bannedAccountId: string; // ID of our account that got banned

  @Prop({
    type: String,
    required: true,
  })
  bannedAccountPhone?: string; // Phone of our account that got banned (optional, for better tracking)

  @Prop({
    type: String,
    required: true,
  })
  bannedByUsername: string; // Username that banned our account

  @Prop({
    type: String,
    required: false,
  })
  bannedByUserId?: string; // Telegram user ID who banned us (if available)

  @Prop({
    type: String,
    required: false,
  })
  bannedByPhone?: string; // Phone number that banned us (if resolving by phone)

  @Prop({
    type: Date,
    default: Date.now,
  })
  bannedAt: Date; // When the ban was detected

  @Prop({
    type: String,
    required: true,
  })
  nodeId: string; // Which node detected the ban

  @Prop({
    type: String,
    default: 'user_banned_account',
  })
  banType: string; // Type of ban (future extensibility)

  @Prop({
    type: Boolean,
    default: true,
  })
  isActive: boolean; // Whether this ban record is still active (for potential unban tracking)
}

@Schema({ timestamps: true, collection: 'account_bans' })
export class AccountBanData extends BaseAccountBanDocument {}

export const AccountBanDataSchema =
  SchemaFactory.createForClass(AccountBanData);

// Create compound index for efficient queries
AccountBanDataSchema.index(
  { bannedAccountId: 1, bannedByUsername: 1 },
  { unique: true },
);
AccountBanDataSchema.index({ bannedByUsername: 1 });
AccountBanDataSchema.index({ bannedAt: -1 });

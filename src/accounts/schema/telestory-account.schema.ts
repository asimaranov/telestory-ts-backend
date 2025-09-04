import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Mixed, SchemaTypes, Types } from 'mongoose';

export type TelestoryAccountDocument = BaseTelestoryAccountDocument & Document;

export class BaseTelestoryAccountDocument extends Document {
  @Prop({
    type: String,
    required: true,
  })
  name: string;
  @Prop({
    type: String,
    required: true,
  })
  sessionData: string;
  @Prop({
    type: Date,
    default: Date.now,
  })
  lastActive: Date;
  @Prop({
    type: Boolean,
    default: true,
  })
  isActive: boolean;
  @Prop({
    type: String,
    default: '',
  })
  inactiveReason: string;
  @Prop({
    type: String,
    enum: ['user', 'bot'],
    default: 'user',
  })
  type: 'user' | 'bot';
  @Prop({
    type: String,
    required: true,
  })
  bindNodeId: string;
  @Prop({
    type: String,
    required: false, // Making it optional for existing accounts
  })
  phone?: string;
  @Prop({
    type: String,
    required: false, // Optional property for account transfer
  })
  transfertonode?: string;
}

@Schema({ timestamps: true, collection: 'telestory_accounts' })
export class TelestoryAccountData extends BaseTelestoryAccountDocument {}

export const TelestoryAccountDataSchema =
  SchemaFactory.createForClass(TelestoryAccountData);

// Add compound unique index to ensure phone uniqueness across bindNodeId
TelestoryAccountDataSchema.index(
  { phone: 1, bindNodeId: 1 },
  {
    unique: true,
    sparse: true, // Allow documents without phone field
    name: 'phone_bindNodeId_unique',
  },
);

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Mixed, SchemaTypes, Types } from 'mongoose';

export type TelestoryPendingAccountDocument =
  BaseTelestoryPendingAccountDocument & Document;

export class BaseTelestoryPendingAccountDocument extends Document {
  @Prop({
    type: String,
    required: true,
  })
  name: string;
  @Prop({
    type: String,
    required: true,
    unique: true,
  })
  phone: string;
  @Prop({
    type: String,
    required: true,
  })
  sessionData: string;
  @Prop({
    type: String,
    required: true,
  })
  phoneCodeHash: string;
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
}

@Schema({ timestamps: true, collection: 'telestory_pending_accounts' })
export class TelestoryPendingAccountData extends BaseTelestoryPendingAccountDocument {}

export const TelestoryPendingAccountDataSchema = SchemaFactory.createForClass(
  TelestoryPendingAccountData,
);

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Mixed, SchemaTypes, Types } from 'mongoose';

export type TelestoryNodeDocument = BaseTelestoryNodeDocument & Document;

export class TelestoryNodeStats {
  @Prop({
    type: Number,
    default: 0,
  })
  downloadsPerLastHour: number;
  @Prop({
    type: Number,
    default: 0,
  })
  downloadsPerLastDay: number;
  @Prop({
    type: Number,
    default: 0,
  })
  downloadsPerLastWeek: number;
  @Prop({
    type: Number,
    default: 0,
  })
  downloadsPerLastMonth: number;
}

export class BaseTelestoryNodeDocument extends Document {
  @Prop({
    type: String,
    required: true,
  })
  name: string;
  @Prop({
    type: String,
    required: true,
  })
  ip: string;
  @Prop({
    type: String,
    required: true,
  })
  apiUrl: string;
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
    enum: ['free', 'premium'],
    default: 'free',
  })
  type: 'free' | 'premium';

  @Prop({
    type: Boolean,
    default: false,
  })
  approvedByMasterNode: boolean;

  @Prop({
    type: TelestoryNodeStats,
    default: new TelestoryNodeStats(),
  })
  stats: TelestoryNodeStats;
  
}

@Schema({ timestamps: true, collection: 'telestory_nodes' })
export class TelestoryNodeData extends BaseTelestoryNodeDocument {}

export const TelestoryNodeDataSchema =
  SchemaFactory.createForClass(TelestoryNodeData);

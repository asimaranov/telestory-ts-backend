import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Mixed, SchemaTypes, Types } from 'mongoose';

export type DownloadsStatsDocument = BaseDownloadsStatsDocument & Document;

export class BaseDownloadsStatsDocument extends Document {
  @Prop({
    type: Date,
    required: true,
  })
  timestamp: Date;
  @Prop({
    type: String,
    required: true,
  })
  nodeName: string;

  @Prop({
    type: String,
    required: true,
  })
  accountName: string;
  @Prop({
    type: Number,
    required: true,
  })
  fileSize: number;
  @Prop({
    type: String,
    required: true,
  })
  fileType: string;
}

@Schema({ timestamps: true, collection: 'downloads_stats' })
export class DownloadsStatsData extends BaseDownloadsStatsDocument {}

export const DownloadsStatsDataSchema =
  SchemaFactory.createForClass(DownloadsStatsData);

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SessionHistoryDocument = SessionHistoryData & Document;

@Schema({
  timestamps: true,
  collection: 'session_history',
})
export class SessionHistoryData {
  @Prop({ required: true, index: true })
  accountName: string;

  @Prop({ required: true, index: true })
  accountPhone?: string;

  @Prop({ required: true })
  sessionData: string;

  @Prop({ required: true, index: true })
  changeType:
    | 'auth_key'
    | 'session_data'
    | 'initial'
    | 'manual_update'
    | 'transfer';

  @Prop({ required: true, index: true })
  nodeId: string;

  @Prop({ required: false })
  changeReason?: string;

  @Prop({ required: false })
  previousSessionHash?: string;

  @Prop({ required: false })
  newSessionHash?: string;

  @Prop({ required: true, default: Date.now, index: true })
  createdAt: Date;

  @Prop({
    required: false,
    type: Object,
  })
  metadata?: {
    userAgent?: string;
    ipAddress?: string;
    connectionInfo?: any;
  };

  @Prop({ required: true, default: false })
  isCompressed: boolean;

  @Prop({ required: false })
  compressionAlgorithm?: string;
}

export const SessionHistorySchema =
  SchemaFactory.createForClass(SessionHistoryData);

// Index for efficient querying by account and time
SessionHistorySchema.index({ accountName: 1, createdAt: -1 });
SessionHistorySchema.index({ accountPhone: 1, createdAt: -1 });
SessionHistorySchema.index({ nodeId: 1, createdAt: -1 });

// TTL index to automatically delete old entries after 90 days
SessionHistorySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);

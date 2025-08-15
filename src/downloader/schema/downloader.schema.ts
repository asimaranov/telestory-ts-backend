import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Mixed, SchemaTypes, Types } from 'mongoose';

export type InvalidUsernameDocument = BaseInvalidUsernameDocument & Document;

export class BaseInvalidUsernameDocument extends Document {
  @Prop({
    type: String,
    required: true,
  })
  username: string;

  @Prop({
    type: Date,
    required: true,
  })
  lastChecked: Date;
}

@Schema({ timestamps: true, collection: 'invalid_usernames' })
export class InvalidUsernamesData extends BaseInvalidUsernameDocument {}

export const InvalidUsernamesDataSchema =
  SchemaFactory.createForClass(InvalidUsernamesData);

// Stories Cache Schema
export type StoriesCacheDocument = BaseStoriesCacheDocument & Document;

export class BaseStoriesCacheDocument extends Document {
  @Prop({
    type: String,
    required: true,
    unique: true,
  })
  username: string;

  @Prop({
    type: SchemaTypes.Mixed,
    required: true,
  })
  storiesData: any[];

  @Prop({
    type: Date,
    required: true,
    index: { expireAfterSeconds: 600 }, // 10 minutes TTL
  })
  expiresAt: Date;

  @Prop({
    type: String,
    required: true,
  })
  cacheKey: string;
}

@Schema({ timestamps: true, collection: 'stories_cache' })
export class StoriesCacheData extends BaseStoriesCacheDocument {}

export const StoriesCacheDataSchema =
  SchemaFactory.createForClass(StoriesCacheData);

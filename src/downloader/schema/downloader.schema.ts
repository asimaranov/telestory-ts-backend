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
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UrlDocument = Url & Document;

@Schema({ timestamps: true })
export class Url {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, unique: true, index: true })
  shortCode: string;

  @Prop({ required: true })
  originalUrl: string;

  @Prop()
  customBackHalf?: string;

  @Prop({ index: true })
  category?: string;

  @Prop({ default: 0, index: -1 })
  visitCount: number;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  expiresAt?: Date;

  @Prop({ index: true })
  customDomain?: string;

  @Prop({
    type: {
      title: String,
      description: String,
      favicon: String,
      image: String,
      siteName: String,
    },
  })
  metadata?: {
    title?: string;
    description?: string;
    favicon?: string;
    image?: string;
    siteName?: string;
  };

  @Prop({
    type: {
      password: String,
      expiresAt: Date,
    },
  })
  protection?: {
    password?: string;
    expiresAt?: Date;
  };

  @Prop({
    type: [{
      name: String,
      value: String,
    }],
  })
  tags?: Array<{
    name: string;
    value: string;
  }>;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const UrlSchema = SchemaFactory.createForClass(Url);

// Create compound indexes for better query performance
UrlSchema.index({ userId: 1, createdAt: -1 });
UrlSchema.index({ userId: 1, category: 1 });
UrlSchema.index({ userId: 1, isActive: 1 });
UrlSchema.index({ shortCode: 1, isActive: 1 });
UrlSchema.index({ expiresAt: 1 }, { sparse: true });
UrlSchema.index({ customDomain: 1 }, { sparse: true });
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ClickEventDocument = ClickEvent & Document;

@Schema({ 
  collection: 'clicks',
  timestamps: true,
  versionKey: false,
  // Enable sharding for high-volume data
  shardKey: { linkId: 1, clickedAt: 1 }
})
export class ClickEvent {
  @Prop({ required: true, index: true })
  linkId: string;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, index: true })
  clickedAt: Date;

  @Prop({ required: true, index: true })
  ipHash: string;

  @Prop()
  userAgent: string;

  @Prop({ index: true })
  browser: string;

  @Prop({ index: true })
  device: string;

  @Prop()
  os: string;

  @Prop({ index: true })
  country: string;

  @Prop()
  city: string;

  @Prop()
  referrer: string;

  @Prop()
  utmSource: string;

  @Prop()
  utmMedium: string;

  @Prop()
  utmCampaign: string;

  @Prop()
  utmTerm: string;

  @Prop()
  utmContent: string;

  @Prop({ default: false })
  isBot: boolean;

  @Prop({ index: true })
  sessionId: string;

  // Automatically added by timestamps: true
  createdAt?: Date;
  updatedAt?: Date;
}

export const ClickEventSchema = SchemaFactory.createForClass(ClickEvent);

// Add compound indexes for common query patterns
ClickEventSchema.index({ linkId: 1, clickedAt: -1 });
ClickEventSchema.index({ userId: 1, clickedAt: -1 });
ClickEventSchema.index({ country: 1, clickedAt: -1 });
ClickEventSchema.index({ device: 1, clickedAt: -1 });
ClickEventSchema.index({ browser: 1, clickedAt: -1 });
ClickEventSchema.index({ sessionId: 1 });
ClickEventSchema.index({ ipHash: 1, clickedAt: -1 });

// TTL index for data retention (optional - remove if you want to keep all data)
// ClickEventSchema.index({ clickedAt: 1 }, { expireAfterSeconds: 31536000 }); // 1 year
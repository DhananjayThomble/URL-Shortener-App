import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ClickAnalyticsDocument = ClickAnalytics & Document;

@Schema({ timestamps: true })
export class ClickAnalytics {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  urlId: Types.ObjectId;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, index: true })
  timestamp: Date;

  @Prop()
  ipAddress: string; // Hashed for privacy

  @Prop()
  userAgent: string;

  @Prop()
  referer: string;

  @Prop()
  country: string;

  @Prop()
  city: string;

  @Prop()
  region: string;

  @Prop()
  timezone: string;

  @Prop()
  device: string;

  @Prop()
  browser: string;

  @Prop()
  browserVersion: string;

  @Prop()
  os: string;

  @Prop()
  osVersion: string;

  @Prop()
  isMobile: boolean;

  @Prop()
  isBot: boolean;

  @Prop()
  language: string;

  @Prop()
  screenResolution: string;

  @Prop()
  customDomain?: string;

  @Prop({
    type: {
      utm_source: String,
      utm_medium: String,
      utm_campaign: String,
      utm_term: String,
      utm_content: String,
    },
  })
  utmParameters?: {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_term?: string;
    utm_content?: string;
  };
}

export const ClickAnalyticsSchema = SchemaFactory.createForClass(ClickAnalytics);

// Create indexes for analytics queries
ClickAnalyticsSchema.index({ urlId: 1, timestamp: -1 });
ClickAnalyticsSchema.index({ userId: 1, timestamp: -1 });
ClickAnalyticsSchema.index({ timestamp: -1 });
ClickAnalyticsSchema.index({ country: 1, timestamp: -1 });
ClickAnalyticsSchema.index({ device: 1, timestamp: -1 });
ClickAnalyticsSchema.index({ browser: 1, timestamp: -1 });
ClickAnalyticsSchema.index({ isBot: 1, timestamp: -1 });
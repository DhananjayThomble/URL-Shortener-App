import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AnalyticsAggregationDocument = AnalyticsAggregation & Document;

export interface DeviceBreakdown {
  desktop: number;
  mobile: number;
  tablet: number;
}

export interface CountryBreakdown {
  [countryCode: string]: number;
}

export interface BrowserBreakdown {
  [browserName: string]: number;
}

export interface ReferrerBreakdown {
  [referrerDomain: string]: number;
}

@Schema({ 
  collection: 'analytics_aggregations',
  timestamps: true,
  versionKey: false,
})
export class AnalyticsAggregation {
  @Prop({ required: true, index: true })
  linkId: string;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, index: true })
  date: Date;

  @Prop({ 
    required: true, 
    enum: ['hour', 'day', 'week', 'month'],
    index: true 
  })
  period: string;

  @Prop({ required: true, min: 0 })
  totalClicks: number;

  @Prop({ required: true, min: 0 })
  uniqueClicks: number;

  @Prop({
    type: {
      desktop: { type: Number, default: 0 },
      mobile: { type: Number, default: 0 },
      tablet: { type: Number, default: 0 },
    },
    default: { desktop: 0, mobile: 0, tablet: 0 }
  })
  deviceBreakdown: DeviceBreakdown;

  @Prop({ type: Map, of: Number, default: {} })
  countryBreakdown: Map<string, number>;

  @Prop({ type: Map, of: Number, default: {} })
  browserBreakdown: Map<string, number>;

  @Prop({ type: Map, of: Number, default: {} })
  referrerBreakdown: Map<string, number>;

  // UTM campaign analytics
  @Prop({ type: Map, of: Number, default: {} })
  utmSourceBreakdown: Map<string, number>;

  @Prop({ type: Map, of: Number, default: {} })
  utmMediumBreakdown: Map<string, number>;

  @Prop({ type: Map, of: Number, default: {} })
  utmCampaignBreakdown: Map<string, number>;

  // Bot traffic tracking
  @Prop({ default: 0, min: 0 })
  botClicks: number;

  // Automatically added by timestamps: true
  createdAt?: Date;
  updatedAt?: Date;
}

export const AnalyticsAggregationSchema = SchemaFactory.createForClass(AnalyticsAggregation);

// Add compound indexes for efficient querying
AnalyticsAggregationSchema.index({ linkId: 1, period: 1, date: -1 });
AnalyticsAggregationSchema.index({ userId: 1, period: 1, date: -1 });
AnalyticsAggregationSchema.index({ date: -1, period: 1 });

// Ensure unique aggregations per link/period/date combination
AnalyticsAggregationSchema.index(
  { linkId: 1, period: 1, date: 1 }, 
  { unique: true }
);
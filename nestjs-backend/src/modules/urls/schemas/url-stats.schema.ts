import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UrlStatsDocument = UrlStats & Document;

@Schema({ timestamps: true })
export class UrlStats {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  urlId: Types.ObjectId;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, index: true })
  date: Date; // Date for daily aggregation (YYYY-MM-DD)

  @Prop({ required: true, index: true })
  period: string; // 'daily', 'weekly', 'monthly'

  @Prop({ default: 0 })
  totalClicks: number;

  @Prop({ default: 0 })
  uniqueClicks: number;

  @Prop({
    type: [{
      country: String,
      count: Number,
    }],
    default: [],
  })
  clicksByCountry: Array<{
    country: string;
    count: number;
  }>;

  @Prop({
    type: [{
      device: String,
      count: Number,
    }],
    default: [],
  })
  clicksByDevice: Array<{
    device: string;
    count: number;
  }>;

  @Prop({
    type: [{
      browser: String,
      count: Number,
    }],
    default: [],
  })
  clicksByBrowser: Array<{
    browser: string;
    count: number;
  }>;

  @Prop({
    type: [{
      referer: String,
      count: Number,
    }],
    default: [],
  })
  clicksByReferer: Array<{
    referer: string;
    count: number;
  }>;

  @Prop({
    type: [{
      hour: Number,
      count: Number,
    }],
    default: [],
  })
  clicksByHour: Array<{
    hour: number;
    count: number;
  }>;

  @Prop({ default: 0 })
  botClicks: number;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const UrlStatsSchema = SchemaFactory.createForClass(UrlStats);

// Create compound indexes for efficient queries
UrlStatsSchema.index({ urlId: 1, period: 1, date: -1 });
UrlStatsSchema.index({ userId: 1, period: 1, date: -1 });
UrlStatsSchema.index({ date: -1, period: 1 });

// Ensure unique combination of urlId, period, and date
UrlStatsSchema.index({ urlId: 1, period: 1, date: 1 }, { unique: true });
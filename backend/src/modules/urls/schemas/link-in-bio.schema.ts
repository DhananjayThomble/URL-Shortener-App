import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type LinkInBioDocument = LinkInBio & Document;

@Schema({ timestamps: true })
export class LinkInBio {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop()
  avatar?: string;

  @Prop({ default: 'default' })
  theme: string;

  @Prop({
    type: [{
      title: { type: String, required: true },
      url: { type: String, required: true },
      isActive: { type: Boolean, default: true },
      order: { type: Number, required: true },
      icon: String,
      description: String,
      clickCount: { type: Number, default: 0 },
    }],
    default: [],
  })
  links: Array<{
    title: string;
    url: string;
    isActive: boolean;
    order: number;
    icon?: string;
    description?: string;
    clickCount: number;
  }>;

  @Prop({ default: true })
  isPublic: boolean;

  @Prop({ unique: true, sparse: true })
  customSlug?: string;

  @Prop({
    type: {
      backgroundColor: String,
      textColor: String,
      linkColor: String,
      buttonStyle: String,
      fontFamily: String,
      customCss: String,
    },
  })
  customization?: {
    backgroundColor?: string;
    textColor?: string;
    linkColor?: string;
    buttonStyle?: string;
    fontFamily?: string;
    customCss?: string;
  };

  @Prop({
    type: [{
      platform: String,
      url: String,
      isVisible: { type: Boolean, default: true },
    }],
  })
  socialLinks?: Array<{
    platform: string;
    url: string;
    isVisible: boolean;
  }>;

  @Prop({ default: 0 })
  totalViews: number;

  @Prop({ default: 0 })
  totalClicks: number;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const LinkInBioSchema = SchemaFactory.createForClass(LinkInBio);

// Create indexes
LinkInBioSchema.index({ userId: 1 });
LinkInBioSchema.index({ customSlug: 1 }, { unique: true, sparse: true });
LinkInBioSchema.index({ isPublic: 1 });
LinkInBioSchema.index({ userId: 1, createdAt: -1 });
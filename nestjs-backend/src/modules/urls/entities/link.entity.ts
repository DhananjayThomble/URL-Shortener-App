import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { GeoRule } from './geo-rule.entity';
import { LinkTag } from './link-tag.entity';

@Entity('links')
@Index(['shortCode'])
@Index(['userId', 'createdAt'])
@Index(['userId', 'isActive'])
@Index(['expiresAt'], { where: 'expires_at IS NOT NULL' })
export class Link {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'original_url', type: 'text' })
  originalUrl: string;

  @Column({ name: 'short_code', unique: true, length: 10 })
  shortCode: string;

  @Column({ name: 'custom_alias', unique: true, nullable: true, length: 50 })
  customAlias?: string;

  @Column({ nullable: true })
  title?: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'expires_at', nullable: true })
  expiresAt?: Date;

  @Column({ name: 'password_hash', nullable: true })
  passwordHash?: string;

  @Column({ name: 'password_hint', nullable: true })
  passwordHint?: string;

  @Column({ name: 'ios_url', type: 'text', nullable: true })
  iosUrl?: string;

  @Column({ name: 'android_url', type: 'text', nullable: true })
  androidUrl?: string;

  @Column({ name: 'utm_source', length: 100, nullable: true })
  utmSource?: string;

  @Column({ name: 'utm_medium', length: 100, nullable: true })
  utmMedium?: string;

  @Column({ name: 'utm_campaign', length: 100, nullable: true })
  utmCampaign?: string;

  @Column({ name: 'utm_term', length: 100, nullable: true })
  utmTerm?: string;

  @Column({ name: 'utm_content', length: 100, nullable: true })
  utmContent?: string;

  @Column({ name: 'meta_pixel_id', length: 50, nullable: true })
  metaPixelId?: string;

  @Column({ name: 'google_analytics_id', length: 50, nullable: true })
  googleAnalyticsId?: string;

  @Column({ name: 'tiktok_pixel_id', length: 50, nullable: true })
  tiktokPixelId?: string;

  @Column({ name: 'visit_count', default: 0 })
  visitCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relationships
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToMany(() => GeoRule, (geoRule) => geoRule.link)
  geoRules: GeoRule[];

  @OneToMany(() => LinkTag, (linkTag) => linkTag.link)
  linkTags: LinkTag[];
}
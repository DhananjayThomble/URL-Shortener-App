import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Link } from './link.entity';

@Entity('geo_rules')
@Index(['linkId'])
export class GeoRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'link_id' })
  linkId: string;

  @Column({ name: 'country_code', length: 2 })
  countryCode: string;

  @Column({ name: 'redirect_url', type: 'text' })
  redirectUrl: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Relationships
  @ManyToOne(() => Link, (link) => link.geoRules, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'link_id' })
  link: Link;
}
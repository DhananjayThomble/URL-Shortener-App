import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Link } from './link.entity';
import { Tag } from './tag.entity';

@Entity('link_tags')
@Index(['linkId'])
@Index(['tagId'])
@Unique(['linkId', 'tagId'])
export class LinkTag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'link_id' })
  linkId: string;

  @Column({ name: 'tag_id' })
  tagId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Relationships
  @ManyToOne(() => Link, (link) => link.linkTags, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'link_id' })
  link: Link;

  @ManyToOne(() => Tag, (tag) => tag.linkTags, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tag_id' })
  tag: Tag;
}
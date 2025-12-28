import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { BioPage } from './bio-page.entity';

@Entity('bio_links')
@Index(['bioPageId', 'position'])
export class BioLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'bio_page_id' })
  bioPageId: string;

  @ManyToOne(() => BioPage, (bioPage) => bioPage.bioLinks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'bio_page_id' })
  bioPage: BioPage;

  @Column({ length: 100 })
  title: string;

  @Column({ type: 'text' })
  url: string;

  @Column({ length: 50, nullable: true })
  icon?: string;

  @Column({ type: 'integer' })
  position: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
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
import { BioLink } from './bio-link.entity';

@Entity('bio_pages')
@Index(['username'], { unique: true })
export class BioPage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ unique: true, length: 50 })
  username: string;

  @Column({ length: 100, nullable: true })
  title?: string;

  @Column({ type: 'text', nullable: true })
  bio?: string;

  @Column({ name: 'avatar_url', nullable: true })
  avatarUrl?: string;

  @Column({ length: 20, default: 'default' })
  theme: string;

  @Column({ name: 'background_color', length: 7, default: '#ffffff' })
  backgroundColor: string;

  @Column({ name: 'text_color', length: 7, default: '#000000' })
  textColor: string;

  @Column({ name: 'button_style', length: 20, default: 'rounded' })
  buttonStyle: string;

  @Column({ name: 'is_public', default: true })
  isPublic: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => BioLink, (bioLink) => bioLink.bioPage, {
    cascade: true,
    eager: false,
  })
  bioLinks: BioLink[];
}
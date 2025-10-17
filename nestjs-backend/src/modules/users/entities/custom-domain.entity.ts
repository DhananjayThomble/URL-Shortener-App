import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('custom_domains')
export class CustomDomain {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  domain: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'is_verified', default: false })
  isVerified: boolean;

  @Column({ name: 'dns_records', type: 'jsonb', nullable: true })
  dnsRecords: {
    type: string;
    name: string;
    value: string;
    ttl?: number;
  }[];

  @Column({ name: 'ssl_certificate', nullable: true })
  sslCertificate?: string;

  @Column({ name: 'ssl_private_key', nullable: true })
  sslPrivateKey?: string;

  @Column({ name: 'ssl_expires_at', nullable: true })
  sslExpiresAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
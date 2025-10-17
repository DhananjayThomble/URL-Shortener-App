import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';

export enum AdminPermission {
  USER_MANAGEMENT = 'user_management',
  URL_MANAGEMENT = 'url_management',
  ANALYTICS_VIEW = 'analytics_view',
  SYSTEM_CONFIG = 'system_config',
  AUDIT_LOGS = 'audit_logs',
}

@Entity('admin_users')
export class AdminUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: 'password_hash' })
  @Exclude()
  passwordHash: string;

  @Column()
  name: string;

  @Column({ type: 'jsonb', default: [] })
  permissions: AdminPermission[];

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'last_login_at', nullable: true })
  lastLoginAt?: Date;

  @Column({ name: 'last_login_ip', nullable: true })
  lastLoginIp?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
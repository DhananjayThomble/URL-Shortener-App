import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum AuditAction {
  USER_CREATED = 'user_created',
  USER_UPDATED = 'user_updated',
  USER_DELETED = 'user_deleted',
  USER_LOGIN = 'user_login',
  USER_LOGOUT = 'user_logout',
  URL_CREATED = 'url_created',
  URL_UPDATED = 'url_updated',
  URL_DELETED = 'url_deleted',
  URL_ACCESSED = 'url_accessed',
  ADMIN_LOGIN = 'admin_login',
  ADMIN_ACTION = 'admin_action',
  SECURITY_EVENT = 'security_event',
}

@Entity('audit_logs')
@Index(['userId', 'createdAt'])
@Index(['action', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', nullable: true })
  userId?: string;

  @Column({ name: 'admin_id', nullable: true })
  adminId?: string;

  @Column({
    type: 'enum',
    enum: AuditAction,
  })
  action: AuditAction;

  @Column()
  resource: string; // e.g., 'user', 'url', 'system'

  @Column({ name: 'resource_id', nullable: true })
  resourceId?: string;

  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, any>;

  @Column({ name: 'ip_address' })
  ipAddress: string;

  @Column({ name: 'user_agent', nullable: true })
  userAgent?: string;

  @Column({ name: 'request_id', nullable: true })
  requestId?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
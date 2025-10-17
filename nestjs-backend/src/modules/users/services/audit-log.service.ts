import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions } from 'typeorm';

import { AuditLog, AuditAction } from '../entities/audit-log.entity';

export interface CreateAuditLogDto {
  userId?: string;
  adminId?: string;
  action: AuditAction;
  resource: string;
  resourceId?: string;
  details?: Record<string, any>;
  ipAddress: string;
  userAgent?: string;
  requestId?: string;
}

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
  ) {}

  async create(createAuditLogDto: CreateAuditLogDto): Promise<AuditLog> {
    const auditLog = this.auditLogRepository.create(createAuditLogDto);
    return this.auditLogRepository.save(auditLog);
  }

  async findAll(options?: FindManyOptions<AuditLog>): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      order: { createdAt: 'DESC' },
      take: 100, // Limit to prevent large queries
      ...options,
    });
  }

  async findByUser(userId: string, limit = 50): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async findByAction(action: AuditAction, limit = 100): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { action },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async findByResource(resource: string, resourceId?: string, limit = 100): Promise<AuditLog[]> {
    const where: any = { resource };
    if (resourceId) {
      where.resourceId = resourceId;
    }

    return this.auditLogRepository.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async findSecurityEvents(limit = 100): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { action: AuditAction.SECURITY_EVENT },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async cleanup(olderThanDays = 90): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    await this.auditLogRepository
      .createQueryBuilder()
      .delete()
      .where('created_at < :cutoffDate', { cutoffDate })
      .execute();
  }

  // Helper methods for common audit events
  async logUserLogin(userId: string, ipAddress: string, userAgent?: string, requestId?: string): Promise<void> {
    await this.create({
      userId,
      action: AuditAction.USER_LOGIN,
      resource: 'user',
      resourceId: userId,
      ipAddress,
      userAgent,
      requestId,
    });
  }

  async logUserLogout(userId: string, ipAddress: string, userAgent?: string, requestId?: string): Promise<void> {
    await this.create({
      userId,
      action: AuditAction.USER_LOGOUT,
      resource: 'user',
      resourceId: userId,
      ipAddress,
      userAgent,
      requestId,
    });
  }

  async logUrlCreated(userId: string, urlId: string, ipAddress: string, details?: Record<string, any>): Promise<void> {
    await this.create({
      userId,
      action: AuditAction.URL_CREATED,
      resource: 'url',
      resourceId: urlId,
      details,
      ipAddress,
    });
  }

  async logUrlAccessed(urlId: string, ipAddress: string, details?: Record<string, any>): Promise<void> {
    await this.create({
      action: AuditAction.URL_ACCESSED,
      resource: 'url',
      resourceId: urlId,
      details,
      ipAddress,
    });
  }

  async logSecurityEvent(
    description: string,
    ipAddress: string,
    userId?: string,
    details?: Record<string, any>
  ): Promise<void> {
    await this.create({
      userId,
      action: AuditAction.SECURITY_EVENT,
      resource: 'security',
      details: { description, ...details },
      ipAddress,
    });
  }
}
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as dns from 'dns';
import { promisify } from 'util';

import { CustomDomain } from '../entities/custom-domain.entity';
import { CreateCustomDomainDto } from '../dto/create-custom-domain.dto';
import { UpdateCustomDomainDto } from '../dto/update-custom-domain.dto';

const resolveTxt = promisify(dns.resolveTxt);

@Injectable()
export class CustomDomainService {
  constructor(
    @InjectRepository(CustomDomain)
    private customDomainRepository: Repository<CustomDomain>,
  ) {}

  async create(createCustomDomainDto: CreateCustomDomainDto, userId: string): Promise<CustomDomain> {
    // Check if domain already exists
    const existingDomain = await this.customDomainRepository.findOne({
      where: { domain: createCustomDomainDto.domain },
    });

    if (existingDomain) {
      throw new BadRequestException('Domain already exists');
    }

    // Validate domain format
    if (!this.isValidDomain(createCustomDomainDto.domain)) {
      throw new BadRequestException('Invalid domain format');
    }

    const customDomain = this.customDomainRepository.create({
      ...createCustomDomainDto,
      userId,
      dnsRecords: this.generateDnsRecords(createCustomDomainDto.domain),
    });

    return this.customDomainRepository.save(customDomain);
  }

  async findAll(userId: string): Promise<CustomDomain[]> {
    return this.customDomainRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId: string): Promise<CustomDomain> {
    const customDomain = await this.customDomainRepository.findOne({
      where: { id, userId },
    });

    if (!customDomain) {
      throw new NotFoundException(`Custom domain with ID ${id} not found`);
    }

    return customDomain;
  }

  async update(id: string, updateCustomDomainDto: UpdateCustomDomainDto, userId: string): Promise<CustomDomain> {
    const customDomain = await this.findOne(id, userId);

    Object.assign(customDomain, updateCustomDomainDto);
    return this.customDomainRepository.save(customDomain);
  }

  async remove(id: string, userId: string): Promise<void> {
    const customDomain = await this.findOne(id, userId);
    await this.customDomainRepository.remove(customDomain);
  }

  async verifyDomain(id: string, userId: string): Promise<CustomDomain> {
    const customDomain = await this.findOne(id, userId);

    try {
      // Verify DNS records
      const isVerified = await this.checkDnsRecords(customDomain.domain, customDomain.dnsRecords);
      
      if (isVerified) {
        customDomain.isVerified = true;
        return this.customDomainRepository.save(customDomain);
      } else {
        throw new BadRequestException('DNS records not properly configured');
      }
    } catch (error) {
      throw new BadRequestException(`Domain verification failed: ${error.message}`);
    }
  }

  private isValidDomain(domain: string): boolean {
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9])*$/;
    return domainRegex.test(domain) && domain.length <= 253;
  }

  private generateDnsRecords(domain: string) {
    return [
      {
        type: 'CNAME',
        name: domain,
        value: 'cname.urlshortener.com',
        ttl: 300,
      },
      {
        type: 'TXT',
        name: `_urlshortener.${domain}`,
        value: `urlshortener-verification=${this.generateVerificationToken()}`,
        ttl: 300,
      },
    ];
  }

  private generateVerificationToken(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  private async checkDnsRecords(domain: string, expectedRecords: any[]): Promise<boolean> {
    try {
      // Check TXT record for verification
      const txtRecord = expectedRecords.find(record => record.type === 'TXT');
      if (txtRecord) {
        const txtRecords = await resolveTxt(txtRecord.name);
        const flatRecords = txtRecords.flat();
        const hasVerificationRecord = flatRecords.some(record => 
          record.includes(txtRecord.value.split('=')[1])
        );
        
        return hasVerificationRecord;
      }
      
      return false;
    } catch (error) {
      console.error('DNS verification error:', error);
      return false;
    }
  }
}
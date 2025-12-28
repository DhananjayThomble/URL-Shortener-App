import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GeoRule } from '../entities/geo-rule.entity';

@Injectable()
export class GeoRuleRepository {
  constructor(
    @InjectRepository(GeoRule)
    private readonly repository: Repository<GeoRule>,
  ) {}

  async create(geoRuleData: Partial<GeoRule>): Promise<GeoRule> {
    const geoRule = this.repository.create(geoRuleData);
    return this.repository.save(geoRule);
  }

  async findById(id: string): Promise<GeoRule | null> {
    return this.repository.findOne({
      where: { id },
      relations: ['link'],
    });
  }

  async findByLinkId(linkId: string): Promise<GeoRule[]> {
    return this.repository.find({
      where: { linkId },
      order: { createdAt: 'ASC' },
    });
  }

  async findByLinkIdAndCountry(
    linkId: string,
    countryCode: string,
  ): Promise<GeoRule | null> {
    return this.repository.findOne({
      where: { linkId, countryCode },
    });
  }

  async update(id: string, updateData: Partial<GeoRule>): Promise<GeoRule> {
    await this.repository.update(id, updateData);
    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  async deleteByLinkId(linkId: string): Promise<void> {
    await this.repository.delete({ linkId });
  }

  async bulkCreate(geoRules: Partial<GeoRule>[]): Promise<GeoRule[]> {
    const entities = this.repository.create(geoRules);
    return this.repository.save(entities);
  }

  async replaceRulesForLink(
    linkId: string,
    newRules: Pick<GeoRule, 'countryCode' | 'redirectUrl'>[],
  ): Promise<GeoRule[]> {
    // Delete existing rules
    await this.deleteByLinkId(linkId);

    // Create new rules
    const rulesToCreate = newRules.map(rule => ({
      ...rule,
      linkId,
    }));

    return this.bulkCreate(rulesToCreate);
  }
}
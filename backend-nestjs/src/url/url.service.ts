import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Url } from './url.entity';

@Injectable()
export class UrlService {
  constructor(
    @InjectRepository(Url)
    private readonly urlRepository: Repository<Url>,
  ) {}

  async createShortUrl(originalUrl: string, userId: number): Promise<Url> {
    const shortUrl = this.generateShortUrl();
    const url = this.urlRepository.create({
      originalUrl,
      shortUrl,
      userId,
    });
    return this.urlRepository.save(url);
  }

  async getUrlByShortUrl(shortUrl: string): Promise<Url> {
    return this.urlRepository.findOne({ where: { shortUrl } });
  }

  async deleteUrl(shortUrl: string, userId: number): Promise<void> {
    await this.urlRepository.delete({ shortUrl, userId });
  }

  async updateCategory(shortUrl: string, userId: number, category: string): Promise<void> {
    await this.urlRepository.update({ shortUrl, userId }, { category });
  }

  async getUrlsByCategory(userId: number, category: string): Promise<Url[]> {
    return this.urlRepository.find({ where: { userId, category } });
  }

  private generateShortUrl(): string {
    // Implement your short URL generation logic here
    return Math.random().toString(36).substring(2, 8);
  }
}

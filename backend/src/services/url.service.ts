import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Url } from '../models/url.model';
import { CreateUrlDto, CustomBackHalfDto, DeleteUrlDto, ExportUrlsDto, FilterCategoryDto, UpdateCategoryDto } from '../dtos/url.dto';
import { Cache } from 'cache-manager';

@Injectable()
export class UrlService {
  constructor(
    @InjectModel(Url.name) private readonly urlModel: Model<Url>,
    private cacheManager: Cache
  ) {}

  async redirectToOriginalUrl(short: string): Promise<string> {
    const cachedUrl = await this.cacheManager.get<string>(short);
    if (cachedUrl) {
      return cachedUrl;
    }

    const url = await this.urlModel.findOne({ short });
    if (!url) {
      throw new NotFoundException('URL not found');
    }

    await this.cacheManager.set(short, url.original, { ttl: 3600 });
    return url.original;
  }

  async generateShortUrl(createUrlDto: CreateUrlDto): Promise<Url> {
    const newUrl = new this.urlModel(createUrlDto);
    await this.cacheManager.set(newUrl.short, newUrl.original, { ttl: 3600 });
    return newUrl.save();
  }

  async generateCustomBackHalf(customBackHalfDto: CustomBackHalfDto): Promise<Url> {
    const { short, customBackHalf } = customBackHalfDto;
    const url = await this.urlModel.findOne({ short });
    if (!url) {
      throw new NotFoundException('URL not found');
    }
    url.customBackHalf = customBackHalf;
    await this.cacheManager.set(customBackHalf, url.original, { ttl: 3600 });
    return url.save();
  }

  async getHistory(userId: string): Promise<Url[]> {
    return this.urlModel.find({ userId });
  }

  async deleteUrl(id: string, deleteUrlDto: DeleteUrlDto): Promise<void> {
    const url = await this.urlModel.findById(id);
    if (!url) {
      throw new NotFoundException('URL not found');
    }
    await this.cacheManager.del(url.short);
    await url.remove();
  }

  async exportGeneratedUrls(exportUrlsDto: ExportUrlsDto): Promise<Url[]> {
    const { userId, startDate, endDate } = exportUrlsDto;
    return this.urlModel.find({
      userId,
      createdAt: { $gte: startDate, $lte: endDate },
    });
  }

  async getFilteredCategory(category: string): Promise<Url[]> {
    return this.urlModel.find({ category });
  }

  async updateCategory(updateCategoryDto: UpdateCategoryDto): Promise<Url> {
    const { id, category } = updateCategoryDto;
    const url = await this.urlModel.findById(id);
    if (!url) {
      throw new NotFoundException('URL not found');
    }
    url.category = category;
    return url.save();
  }
}

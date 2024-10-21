import { Controller, Post, Get, Delete, Put, Body, Param, UseGuards, Request } from '@nestjs/common';
import { UrlService } from './url.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('url')
export class UrlController {
  constructor(private readonly urlService: UrlService) {}

  @UseGuards(JwtAuthGuard)
  @Post('create')
  async createShortUrl(@Body('originalUrl') originalUrl: string, @Request() req): Promise<{ shortUrl: string }> {
    const url = await this.urlService.createShortUrl(originalUrl, req.user.id);
    return { shortUrl: url.shortUrl };
  }

  @Get(':shortUrl')
  async getUrlByShortUrl(@Param('shortUrl') shortUrl: string): Promise<{ originalUrl: string }> {
    const url = await this.urlService.getUrlByShortUrl(shortUrl);
    return { originalUrl: url.originalUrl };
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':shortUrl')
  async deleteUrl(@Param('shortUrl') shortUrl: string, @Request() req): Promise<void> {
    await this.urlService.deleteUrl(shortUrl, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Put('update-category')
  async updateCategory(@Body('shortUrl') shortUrl: string, @Body('category') category: string, @Request() req): Promise<void> {
    await this.urlService.updateCategory(shortUrl, req.user.id, category);
  }

  @UseGuards(JwtAuthGuard)
  @Get('category/:category')
  async getUrlsByCategory(@Param('category') category: string, @Request() req): Promise<{ urls: { shortUrl: string, originalUrl: string }[] }> {
    const urls = await this.urlService.getUrlsByCategory(req.user.id, category);
    return { urls: urls.map(url => ({ shortUrl: url.shortUrl, originalUrl: url.originalUrl })) };
  }
}

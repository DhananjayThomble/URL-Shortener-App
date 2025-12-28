import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
  Res,
  Put,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { Throttle } from '../../common/decorators/throttle.decorator';
import { Public } from '../../common/decorators/public.decorator';

import { UrlsService } from './urls.service';
import { CreateUrlDto } from './dto/create-url.dto';
import { UpdateUrlDto } from './dto/update-url.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('urls')
@Controller('urls')
export class UrlsController {
  constructor(private readonly urlsService: UrlsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ name: 'url-creation', ttl: 60000, limit: 10 })
  @ApiOperation({ summary: 'Create a new short URL' })
  @ApiResponse({ status: 201, description: 'URL created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid URL or custom back-half already exists' })
  async create(@Body() createUrlDto: CreateUrlDto, @Request() req) {
    return this.urlsService.create(createUrlDto, req.user.id);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all URLs for the authenticated user' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page' })
  @ApiResponse({ status: 200, description: 'URLs retrieved successfully' })
  async findAll(
    @Request() req,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.urlsService.findAll(req.user.id, +page, +limit);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a specific URL by ID' })
  @ApiResponse({ status: 200, description: 'URL retrieved successfully' })
  @ApiResponse({ status: 404, description: 'URL not found' })
  async findOne(@Param('id') id: string, @Request() req) {
    return this.urlsService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a URL' })
  @ApiResponse({ status: 200, description: 'URL updated successfully' })
  @ApiResponse({ status: 404, description: 'URL not found' })
  async update(
    @Param('id') id: string,
    @Body() updateUrlDto: UpdateUrlDto,
    @Request() req,
  ) {
    return this.urlsService.update(id, updateUrlDto, req.user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a URL' })
  @ApiResponse({ status: 200, description: 'URL deleted successfully' })
  @ApiResponse({ status: 404, description: 'URL not found' })
  async remove(@Param('id') id: string, @Request() req) {
    await this.urlsService.remove(id, req.user.id);
    return { message: 'URL deleted successfully' };
  }

  @Get(':id/analytics')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get URL analytics' })
  @ApiQuery({ name: 'period', required: false, enum: ['24h', '7d', '30d', '90d'] })
  @ApiResponse({ status: 200, description: 'Analytics retrieved successfully' })
  async getAnalytics(
    @Param('id') id: string,
    @Request() req,
    @Query('period') period = '7d',
  ) {
    return this.urlsService.getUrlAnalytics(id, req.user.id, period);
  }

  @Post('bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ name: 'url-creation', ttl: 60000, limit: 5 })
  @ApiOperation({ summary: 'Create multiple URLs at once' })
  @ApiResponse({ status: 201, description: 'URLs created successfully' })
  async bulkCreate(@Body() createUrlDtos: CreateUrlDto[], @Request() req) {
    return this.urlsService.bulkCreate(createUrlDtos, req.user.id);
  }

  @Get('category/:category')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get URLs by category' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findByCategory(
    @Param('category') category: string,
    @Request() req,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.urlsService.findByCategory(req.user.id, category, +page, +limit);
  }

  @Post('search/tags')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search URLs by tags' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findByTags(
    @Body() body: { tags: string[] },
    @Request() req,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.urlsService.findByTags(req.user.id, body.tags, +page, +limit);
  }

  @Put(':id/password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set password protection for URL' })
  @ApiResponse({ status: 200, description: 'Password set successfully' })
  async setPassword(
    @Param('id') id: string,
    @Body() body: { password: string },
    @Request() req,
  ) {
    return this.urlsService.setUrlPassword(id, req.user.id, body.password);
  }

  @Delete(':id/password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove password protection from URL' })
  @ApiResponse({ status: 200, description: 'Password protection removed successfully' })
  async removePassword(@Param('id') id: string, @Request() req) {
    return this.urlsService.setUrlPassword(id, req.user.id, null);
  }

  @Put(':id/deactivate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deactivate a URL' })
  @ApiResponse({ status: 200, description: 'URL deactivated successfully' })
  async deactivate(@Param('id') id: string, @Request() req) {
    return this.urlsService.deactivateUrl(id, req.user.id);
  }

  @Put(':id/reactivate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reactivate a URL' })
  @ApiResponse({ status: 200, description: 'URL reactivated successfully' })
  async reactivate(@Param('id') id: string, @Request() req) {
    return this.urlsService.reactivateUrl(id, req.user.id);
  }

  @Get('popular/top')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get most popular URLs' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getPopular(@Request() req, @Query('limit') limit = 10) {
    return this.urlsService.getPopularUrls(req.user.id, +limit);
  }
}

// Separate controller for public URL redirection
@Controller('r') // Use 'r' prefix to avoid conflicts
export class RedirectController {
  constructor(private readonly urlsService: UrlsService) {}

  @Get(':shortCode')
  @Public()
  @Throttle({ name: 'url-access', ttl: 60000, limit: 100 })
  @ApiOperation({ summary: 'Redirect to original URL' })
  @ApiResponse({ status: 302, description: 'Redirect to original URL' })
  @ApiResponse({ status: 404, description: 'URL not found or expired' })
  @ApiResponse({ status: 401, description: 'Password required' })
  async redirect(
    @Param('shortCode') shortCode: string,
    @Res() res: Response,
    @Request() req,
    @Query('password') password?: string,
  ) {
    try {
      // Check if password is required and validate it
      if (password !== undefined) {
        const isValidPassword = await this.urlsService.validateUrlPassword(shortCode, password);
        if (!isValidPassword) {
          return res.status(401).json({ 
            error: 'Invalid password',
            requiresPassword: true 
          });
        }
      }

      const originalUrl = await this.urlsService.findByShortCode(shortCode);
      
      // Enhanced click analytics
      await this.urlsService.trackClick(shortCode, {
        ipAddress: req.ip,
        userAgent: req.get('User-Agent') || '',
        referer: req.get('Referer') || '',
        language: req.get('Accept-Language') || '',
        country: req.get('CF-IPCountry') || 'Unknown', // Cloudflare header
        city: req.get('CF-IPCity') || 'Unknown',
        region: req.get('CF-Region') || 'Unknown',
        timezone: req.get('CF-Timezone') || 'Unknown',
        customDomain: req.get('Host'),
      });

      return res.redirect(302, originalUrl);
    } catch (error) {
      if (error.message.includes('password')) {
        return res.status(401).json({ 
          error: 'Password required',
          requiresPassword: true 
        });
      }
      
      return res.status(404).json({ 
        error: 'URL not found or expired' 
      });
    }
  }

  @Post(':shortCode/validate-password')
  @Public()
  @ApiOperation({ summary: 'Validate URL password' })
  @ApiResponse({ status: 200, description: 'Password validation result' })
  async validatePassword(
    @Param('shortCode') shortCode: string,
    @Body() body: { password: string },
  ) {
    const isValid = await this.urlsService.validateUrlPassword(shortCode, body.password);
    return { valid: isValid };
  }
}


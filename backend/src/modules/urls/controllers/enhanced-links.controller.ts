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
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { Response } from 'express';
import { EnhancedLinksService } from '../services/enhanced-links.service';
import { PasswordProtectionService } from '../services/password-protection.service';
import { GeoTargetingService } from '../services/geo-targeting.service';
import { DeviceDetectionService } from '../services/device-detection.service';
import { UTMParameterService } from '../services/utm-parameter.service';
import { TrackingPixelService } from '../services/tracking-pixel.service';
import { EnhancedCreateUrlDto } from '../dto/enhanced-create-url.dto';
import { SetPasswordDto, ValidatePasswordDto, ChangePasswordDto, UpdatePasswordHintDto } from '../dto/password-operations.dto';
import { UpdateGeoRulesDto, GeoTargetingStatsDto } from '../dto/geo-targeting.dto';
import { EnhancedJwtAuthGuard } from '../../auth/guards/enhanced-jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { HttpCache } from '../../../common/interceptors/http-cache.interceptor';

@ApiTags('enhanced-links')
@Controller('enhanced-links')
export class EnhancedLinksController {
  constructor(
    private readonly enhancedLinksService: EnhancedLinksService,
    private readonly passwordProtectionService: PasswordProtectionService,
    private readonly geoTargetingService: GeoTargetingService,
    private readonly deviceDetectionService: DeviceDetectionService,
    private readonly utmParameterService: UTMParameterService,
    private readonly trackingPixelService: TrackingPixelService,
  ) {}

  @Post()
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create an enhanced short URL with advanced features' })
  @ApiResponse({ status: 201, description: 'Enhanced URL created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async createEnhancedLink(
    @Body() createUrlDto: EnhancedCreateUrlDto,
    @CurrentUser() user: any,
  ) {
    return this.enhancedLinksService.createEnhancedLink(createUrlDto, user.id);
  }

  @Get(':id')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @HttpCache({ type: 'user-data', maxAge: 900, private: true, etag: true, lastModified: true })
  @ApiOperation({ summary: 'Get enhanced link details' })
  @ApiResponse({ status: 200, description: 'Enhanced link retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Link not found' })
  async getEnhancedLink(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.enhancedLinksService.getEnhancedLink(id, user.id);
  }

  @Patch(':id')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update enhanced link' })
  @ApiResponse({ status: 200, description: 'Enhanced link updated successfully' })
  @ApiResponse({ status: 404, description: 'Link not found' })
  async updateEnhancedLink(
    @Param('id') id: string,
    @Body() updateData: Partial<EnhancedCreateUrlDto>,
    @CurrentUser() user: any,
  ) {
    return this.enhancedLinksService.updateEnhancedLink(id, user.id, updateData);
  }

  @Delete(':id')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete enhanced link' })
  @ApiResponse({ status: 200, description: 'Enhanced link deleted successfully' })
  @ApiResponse({ status: 404, description: 'Link not found' })
  async deleteEnhancedLink(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    await this.enhancedLinksService.deleteEnhancedLink(id, user.id);
    return { message: 'Enhanced link deleted successfully' };
  }

  // Password Protection Endpoints
  @Put(':id/password')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set password protection for link' })
  @ApiResponse({ status: 200, description: 'Password protection set successfully' })
  async setLinkPassword(
    @Param('id') id: string,
    @Body() setPasswordDto: SetPasswordDto,
    @CurrentUser() user: any,
  ) {
    return this.passwordProtectionService.setLinkPassword(id, user.id, {
      password: setPasswordDto.password,
      hint: setPasswordDto.hint,
    });
  }

  @Delete(':id/password')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove password protection from link' })
  @ApiResponse({ status: 200, description: 'Password protection removed successfully' })
  async removeLinkPassword(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.passwordProtectionService.removeLinkPassword(id, user.id);
  }

  @Put(':id/password/change')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change link password' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  async changeLinkPassword(
    @Param('id') id: string,
    @Body() changePasswordDto: ChangePasswordDto,
    @CurrentUser() user: any,
  ) {
    return this.passwordProtectionService.changeLinkPassword(
      id,
      user.id,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword,
      changePasswordDto.hint,
    );
  }

  @Put(':id/password/hint')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update password hint' })
  @ApiResponse({ status: 200, description: 'Password hint updated successfully' })
  async updatePasswordHint(
    @Param('id') id: string,
    @Body() updateHintDto: UpdatePasswordHintDto,
    @CurrentUser() user: any,
  ) {
    return this.passwordProtectionService.updatePasswordHint(
      id,
      user.id,
      updateHintDto.hint,
    );
  }

  // Geo-targeting Endpoints
  @Put(':id/geo-rules')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update geo-targeting rules for link' })
  @ApiResponse({ status: 200, description: 'Geo-targeting rules updated successfully' })
  async updateGeoRules(
    @Param('id') id: string,
    @Body() updateGeoRulesDto: UpdateGeoRulesDto,
    @CurrentUser() user: any,
  ) {
    return this.geoTargetingService.updateGeoRules(
      id,
      user.id,
      updateGeoRulesDto.rules,
    );
  }

  @Get(':id/geo-rules')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @HttpCache({ type: 'user-data', maxAge: 600, private: true, etag: true })
  @ApiOperation({ summary: 'Get geo-targeting rules for link' })
  @ApiResponse({ status: 200, description: 'Geo-targeting rules retrieved successfully' })
  async getGeoRules(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.geoTargetingService.getGeoRules(id, user.id);
  }

  @Delete(':id/geo-rules')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete all geo-targeting rules for link' })
  @ApiResponse({ status: 200, description: 'Geo-targeting rules deleted successfully' })
  async deleteGeoRules(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    await this.geoTargetingService.deleteGeoRules(id, user.id);
    return { message: 'Geo-targeting rules deleted successfully' };
  }

  @Get(':id/geo-stats')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @HttpCache({ type: 'analytics', maxAge: 300, private: true, etag: true })
  @ApiOperation({ summary: 'Get geo-targeting statistics for link' })
  @ApiQuery({ name: 'period', required: false, enum: ['24h', '7d', '30d', '90d'] })
  @ApiResponse({ status: 200, description: 'Geo-targeting statistics retrieved successfully' })
  async getGeoTargetingStats(
    @Param('id') id: string,
    @Query('period') period = '7d',
    @CurrentUser() user: any,
  ) {
    return this.geoTargetingService.getGeoTargetingStats(id, user.id, period);
  }

  // Utility Endpoints
  @Get('utils/supported-countries')
  @Public()
  @HttpCache({ type: 'api-metadata', maxAge: 86400, private: false, etag: true })
  @ApiOperation({ summary: 'Get list of supported country codes for geo-targeting' })
  @ApiResponse({ status: 200, description: 'Supported country codes retrieved successfully' })
  getSupportedCountries() {
    return {
      countries: this.geoTargetingService.getSupportedCountryCodes(),
    };
  }

  @Get('utils/utm-suggestions')
  @Public()
  @HttpCache({ type: 'api-metadata', maxAge: 86400, private: false, etag: true })
  @ApiOperation({ summary: 'Get UTM parameter suggestions' })
  @ApiResponse({ status: 200, description: 'UTM suggestions retrieved successfully' })
  getUTMSuggestions() {
    return this.utmParameterService.getUTMSuggestions();
  }

  @Get('utils/tracking-providers')
  @Public()
  @HttpCache({ type: 'api-metadata', maxAge: 86400, private: false, etag: true })
  @ApiOperation({ summary: 'Get supported tracking pixel providers' })
  @ApiResponse({ status: 200, description: 'Tracking providers retrieved successfully' })
  getTrackingProviders() {
    return {
      providers: this.trackingPixelService.getSupportedProviders(),
    };
  }

  @Post('utils/validate-password-strength')
  @Public()
  @ApiOperation({ summary: 'Validate password strength' })
  @ApiResponse({ status: 200, description: 'Password strength validation result' })
  validatePasswordStrength(@Body() body: { password: string }) {
    return this.passwordProtectionService.validatePasswordStrength(body.password);
  }

  @Post('utils/parse-user-agent')
  @Public()
  @ApiOperation({ summary: 'Parse user agent string for device information' })
  @ApiResponse({ status: 200, description: 'User agent parsed successfully' })
  parseUserAgent(@Body() body: { userAgent: string }) {
    return this.deviceDetectionService.parseUserAgent(body.userAgent);
  }
}

// Enhanced Redirect Controller
@Controller('r')
export class EnhancedRedirectController {
  constructor(
    private readonly enhancedLinksService: EnhancedLinksService,
  ) {}

  @Get(':shortCode')
  @Public()
  @HttpCache({ type: 'url-resolution', maxAge: 3600, private: false, etag: true })
  @ApiOperation({ summary: 'Enhanced redirect with all advanced features' })
  @ApiResponse({ status: 302, description: 'Redirect to target URL' })
  @ApiResponse({ status: 404, description: 'Link not found or expired' })
  @ApiResponse({ status: 401, description: 'Password required' })
  async enhancedRedirect(
    @Param('shortCode') shortCode: string,
    @Res() res: Response,
    @Request() req,
    @Query('password') password?: string,
  ) {
    try {
      const decision = await this.enhancedLinksService.makeRedirectDecision(
        shortCode,
        req.ip || req.connection.remoteAddress,
        req.get('User-Agent') || '',
        req.get('Referer'),
        password,
      );

      // Log analytics data
      console.log('Redirect Analytics:', JSON.stringify(decision.analytics, null, 2));

      return res.redirect(HttpStatus.FOUND, decision.finalUrl);
    } catch (error) {
      if (error.message.includes('password')) {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          error: 'Password required',
          requiresPassword: true,
          hint: await this.getPasswordHint(shortCode),
        });
      }

      return res.status(HttpStatus.NOT_FOUND).json({
        error: 'Link not found or expired',
      });
    }
  }

  @Post(':shortCode/validate-password')
  @Public()
  @ApiOperation({ summary: 'Validate password for protected link' })
  @ApiResponse({ status: 200, description: 'Password validation result' })
  async validateLinkPassword(
    @Param('shortCode') shortCode: string,
    @Body() validatePasswordDto: ValidatePasswordDto,
  ) {
    // This would typically use the password protection service
    // For now, return a placeholder response
    return { valid: true };
  }

  private async getPasswordHint(shortCode: string): Promise<string | null> {
    // This would get the password hint from the password protection service
    return null;
  }
}
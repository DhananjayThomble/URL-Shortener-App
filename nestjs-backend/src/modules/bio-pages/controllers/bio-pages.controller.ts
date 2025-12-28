import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { BioPageService, BioLinkService } from '../services';
import {
  CreateBioPageDto,
  UpdateBioPageDto,
  CreateBioLinkDto,
  UpdateBioLinkDto,
  ReorderBioLinksDto,
} from '../dto';
import { BioPage, BioLink } from '../entities';
import { EnhancedJwtAuthGuard } from '../../auth/guards/enhanced-jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Bio Pages')
@Controller('bio-pages')
export class BioPagesController {
  constructor(
    private readonly bioPageService: BioPageService,
    private readonly bioLinkService: BioLinkService,
  ) {}

  @Post()
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a bio page' })
  @ApiResponse({ status: 201, description: 'Bio page created successfully' })
  @ApiResponse({ status: 409, description: 'Username already taken or user already has a bio page' })
  async createBioPage(
    @CurrentUser('id') userId: string,
    @Body() createBioPageDto: CreateBioPageDto,
  ): Promise<BioPage> {
    return await this.bioPageService.create(userId, createBioPageDto);
  }

  @Get('my-bio-page')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user bio page' })
  @ApiResponse({ status: 200, description: 'Bio page retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Bio page not found' })
  async getMyBioPage(@CurrentUser('id') userId: string): Promise<BioPage> {
    return await this.bioPageService.findByUserId(userId);
  }

  @Put('my-bio-page')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user bio page' })
  @ApiResponse({ status: 200, description: 'Bio page updated successfully' })
  @ApiResponse({ status: 404, description: 'Bio page not found' })
  async updateMyBioPage(
    @CurrentUser('id') userId: string,
    @Body() updateBioPageDto: UpdateBioPageDto,
  ): Promise<BioPage> {
    return await this.bioPageService.update(userId, updateBioPageDto);
  }

  @Delete('my-bio-page')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete current user bio page' })
  @ApiResponse({ status: 204, description: 'Bio page deleted successfully' })
  @ApiResponse({ status: 404, description: 'Bio page not found' })
  async deleteMyBioPage(@CurrentUser('id') userId: string): Promise<void> {
    await this.bioPageService.delete(userId);
  }

  @Put('my-bio-page/toggle-visibility')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle bio page visibility' })
  @ApiResponse({ status: 200, description: 'Bio page visibility toggled successfully' })
  @ApiResponse({ status: 404, description: 'Bio page not found' })
  async toggleVisibility(@CurrentUser('id') userId: string): Promise<BioPage> {
    return await this.bioPageService.toggleVisibility(userId);
  }

  @Put('my-bio-page/theme')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update bio page theme' })
  @ApiResponse({ status: 200, description: 'Bio page theme updated successfully' })
  @ApiResponse({ status: 404, description: 'Bio page not found' })
  async updateTheme(
    @CurrentUser('id') userId: string,
    @Body() themeData: {
      theme?: string;
      backgroundColor?: string;
      textColor?: string;
      buttonStyle?: string;
    },
  ): Promise<BioPage> {
    return await this.bioPageService.updateTheme(userId, themeData);
  }

  @Get('check-username/:username')
  @ApiOperation({ summary: 'Check if username is available' })
  @ApiResponse({ status: 200, description: 'Username availability checked' })
  async checkUsernameAvailability(
    @Param('username') username: string,
  ): Promise<{ available: boolean }> {
    const available = await this.bioPageService.isUsernameAvailable(username);
    return { available };
  }

  @Get(':username')
  @ApiOperation({ summary: 'Get public bio page by username' })
  @ApiResponse({ status: 200, description: 'Public bio page retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Bio page not found' })
  @ApiResponse({ status: 403, description: 'Bio page is private' })
  async getPublicBioPage(@Param('username') username: string): Promise<BioPage> {
    return await this.bioPageService.getPublicBioPage(username);
  }

  // Bio Links Management Endpoints

  @Post('my-bio-page/links')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a bio link' })
  @ApiResponse({ status: 201, description: 'Bio link created successfully' })
  @ApiResponse({ status: 404, description: 'Bio page not found' })
  async addBioLink(
    @CurrentUser('id') userId: string,
    @Body() createBioLinkDto: CreateBioLinkDto,
  ): Promise<BioLink> {
    // First get the user's bio page
    const bioPage = await this.bioPageService.findByUserId(userId);
    return await this.bioLinkService.create(userId, bioPage.id, createBioLinkDto);
  }

  @Get('my-bio-page/links')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all bio links for current user' })
  @ApiResponse({ status: 200, description: 'Bio links retrieved successfully' })
  async getMyBioLinks(@CurrentUser('id') userId: string): Promise<BioLink[]> {
    const bioPage = await this.bioPageService.findByUserId(userId);
    return await this.bioLinkService.findAllByBioPageId(bioPage.id);
  }

  @Put('links/:linkId')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a bio link' })
  @ApiResponse({ status: 200, description: 'Bio link updated successfully' })
  @ApiResponse({ status: 404, description: 'Bio link not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async updateBioLink(
    @CurrentUser('id') userId: string,
    @Param('linkId') linkId: string,
    @Body() updateBioLinkDto: UpdateBioLinkDto,
  ): Promise<BioLink> {
    return await this.bioLinkService.update(userId, linkId, updateBioLinkDto);
  }

  @Delete('links/:linkId')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a bio link' })
  @ApiResponse({ status: 204, description: 'Bio link deleted successfully' })
  @ApiResponse({ status: 404, description: 'Bio link not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async deleteBioLink(
    @CurrentUser('id') userId: string,
    @Param('linkId') linkId: string,
  ): Promise<void> {
    await this.bioLinkService.delete(userId, linkId);
  }

  @Put('my-bio-page/links/reorder')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reorder bio links' })
  @ApiResponse({ status: 200, description: 'Bio links reordered successfully' })
  @ApiResponse({ status: 400, description: 'Invalid reorder data' })
  @ApiResponse({ status: 404, description: 'Bio page not found' })
  async reorderBioLinks(
    @CurrentUser('id') userId: string,
    @Body() reorderDto: ReorderBioLinksDto,
  ): Promise<BioLink[]> {
    const bioPage = await this.bioPageService.findByUserId(userId);
    return await this.bioLinkService.reorderLinks(userId, bioPage.id, reorderDto);
  }

  @Put('links/:linkId/toggle-active')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle bio link active status' })
  @ApiResponse({ status: 200, description: 'Bio link status toggled successfully' })
  @ApiResponse({ status: 404, description: 'Bio link not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async toggleBioLinkActive(
    @CurrentUser('id') userId: string,
    @Param('linkId') linkId: string,
  ): Promise<BioLink> {
    return await this.bioLinkService.toggleActive(userId, linkId);
  }

  @Put('links/:linkId/move-up')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Move bio link up in order' })
  @ApiResponse({ status: 200, description: 'Bio link moved up successfully' })
  @ApiResponse({ status: 400, description: 'Link is already at the top' })
  @ApiResponse({ status: 404, description: 'Bio link not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async moveBioLinkUp(
    @CurrentUser('id') userId: string,
    @Param('linkId') linkId: string,
  ): Promise<BioLink[]> {
    return await this.bioLinkService.moveUp(userId, linkId);
  }

  @Put('links/:linkId/move-down')
  @UseGuards(EnhancedJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Move bio link down in order' })
  @ApiResponse({ status: 200, description: 'Bio link moved down successfully' })
  @ApiResponse({ status: 400, description: 'Link is already at the bottom' })
  @ApiResponse({ status: 404, description: 'Bio link not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async moveBioLinkDown(
    @CurrentUser('id') userId: string,
    @Param('linkId') linkId: string,
  ): Promise<BioLink[]> {
    return await this.bioLinkService.moveDown(userId, linkId);
  }
}
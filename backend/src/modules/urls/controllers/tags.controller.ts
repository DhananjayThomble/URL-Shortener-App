import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ParseBoolPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { EnhancedJwtAuthGuard } from '../../auth/guards/enhanced-jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { TagsService } from '../services/tags.service';
import { TagAssociationService } from '../services/tag-association.service';
import { CreateTagDto } from '../dto/create-tag.dto';
import { UpdateTagDto } from '../dto/update-tag.dto';
import { TagResponseDto } from '../dto/tag-response.dto';
import {
  AssignTagsToLinkDto,
  RemoveTagsFromLinkDto,
  UpdateLinkTagsDto,
  FilterLinksByTagsDto,
} from '../dto/tag-link-operations.dto';
import { Link } from '../entities/link.entity';

@ApiTags('Tags')
@ApiBearerAuth()
@UseGuards(EnhancedJwtAuthGuard)
@Controller('tags')
export class TagsController {
  constructor(
    private readonly tagsService: TagsService,
    private readonly tagAssociationService: TagAssociationService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new tag' })
  @ApiResponse({
    status: 201,
    description: 'Tag created successfully',
    type: TagResponseDto,
  })
  @ApiResponse({ status: 409, description: 'Tag name already exists for user' })
  async createTag(
    @CurrentUser('id') userId: string,
    @Body() createTagDto: CreateTagDto,
  ): Promise<TagResponseDto> {
    return await this.tagsService.createTag(userId, createTagDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all tags for the current user' })
  @ApiQuery({
    name: 'includeLinkCount',
    required: false,
    type: Boolean,
    description: 'Include link count for each tag',
  })
  @ApiResponse({
    status: 200,
    description: 'Tags retrieved successfully',
    type: [TagResponseDto],
  })
  async getUserTags(
    @CurrentUser('id') userId: string,
    @Query('includeLinkCount', new ParseBoolPipe({ optional: true }))
    includeLinkCount?: boolean,
  ): Promise<TagResponseDto[]> {
    return await this.tagsService.getUserTags(userId, includeLinkCount || false);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific tag by ID' })
  @ApiParam({ name: 'id', description: 'Tag ID' })
  @ApiResponse({
    status: 200,
    description: 'Tag retrieved successfully',
    type: TagResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Tag not found' })
  async getTagById(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) tagId: string,
  ): Promise<TagResponseDto> {
    return await this.tagsService.getTagById(userId, tagId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a tag' })
  @ApiParam({ name: 'id', description: 'Tag ID' })
  @ApiResponse({
    status: 200,
    description: 'Tag updated successfully',
    type: TagResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Tag not found' })
  @ApiResponse({ status: 409, description: 'Tag name already exists for user' })
  async updateTag(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) tagId: string,
    @Body() updateTagDto: UpdateTagDto,
  ): Promise<TagResponseDto> {
    return await this.tagsService.updateTag(userId, tagId, updateTagDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a tag' })
  @ApiParam({ name: 'id', description: 'Tag ID' })
  @ApiResponse({ status: 204, description: 'Tag deleted successfully' })
  @ApiResponse({ status: 404, description: 'Tag not found' })
  async deleteTag(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) tagId: string,
  ): Promise<void> {
    await this.tagsService.deleteTag(userId, tagId);
  }

  // Link-Tag Association Endpoints

  @Post('links/:linkId/assign')
  @ApiOperation({ summary: 'Assign tags to a link' })
  @ApiParam({ name: 'linkId', description: 'Link ID' })
  @ApiResponse({
    status: 200,
    description: 'Tags assigned successfully',
    type: [TagResponseDto],
  })
  @ApiResponse({ status: 404, description: 'Link not found' })
  @ApiResponse({ status: 409, description: 'Tags already assigned to link' })
  async assignTagsToLink(
    @CurrentUser('id') userId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Body() assignTagsDto: AssignTagsToLinkDto,
  ): Promise<TagResponseDto[]> {
    return await this.tagAssociationService.assignTagsToLink(userId, linkId, assignTagsDto);
  }

  @Post('links/:linkId/remove')
  @ApiOperation({ summary: 'Remove tags from a link' })
  @ApiParam({ name: 'linkId', description: 'Link ID' })
  @ApiResponse({
    status: 200,
    description: 'Tags removed successfully',
    type: [TagResponseDto],
  })
  @ApiResponse({ status: 404, description: 'Link not found' })
  @ApiResponse({ status: 400, description: 'Tags not assigned to link' })
  async removeTagsFromLink(
    @CurrentUser('id') userId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Body() removeTagsDto: RemoveTagsFromLinkDto,
  ): Promise<TagResponseDto[]> {
    return await this.tagAssociationService.removeTagsFromLink(userId, linkId, removeTagsDto);
  }

  @Put('links/:linkId/tags')
  @ApiOperation({ summary: 'Update all tags for a link (replace existing tags)' })
  @ApiParam({ name: 'linkId', description: 'Link ID' })
  @ApiResponse({
    status: 200,
    description: 'Link tags updated successfully',
    type: [TagResponseDto],
  })
  @ApiResponse({ status: 404, description: 'Link not found' })
  async updateLinkTags(
    @CurrentUser('id') userId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Body() updateTagsDto: UpdateLinkTagsDto,
  ): Promise<TagResponseDto[]> {
    return await this.tagAssociationService.updateLinkTags(userId, linkId, updateTagsDto);
  }

  @Get('links/:linkId/tags')
  @ApiOperation({ summary: 'Get all tags for a specific link' })
  @ApiParam({ name: 'linkId', description: 'Link ID' })
  @ApiResponse({
    status: 200,
    description: 'Link tags retrieved successfully',
    type: [TagResponseDto],
  })
  @ApiResponse({ status: 404, description: 'Link not found' })
  async getTagsForLink(
    @CurrentUser('id') userId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
  ): Promise<TagResponseDto[]> {
    return await this.tagAssociationService.getTagsForLink(userId, linkId);
  }

  @Post('filter-links')
  @ApiOperation({ summary: 'Filter links by tags' })
  @ApiResponse({
    status: 200,
    description: 'Filtered links retrieved successfully',
    type: [Link],
  })
  async filterLinksByTags(
    @CurrentUser('id') userId: string,
    @Body() filterDto: FilterLinksByTagsDto,
  ): Promise<Link[]> {
    return await this.tagAssociationService.filterLinksByTags(userId, filterDto);
  }
}
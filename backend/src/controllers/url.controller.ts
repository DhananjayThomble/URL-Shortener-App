import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, UsePipes, ValidationPipe, Put } from '@nestjs/common';
import { UrlService } from '../services/url.service';
import { CreateUrlDto, CustomBackHalfDto, DeleteUrlDto, ExportUrlsDto, FilterCategoryDto, UpdateCategoryDto } from '../dtos/url.dto';
import { AuthGuard } from '../guards/auth.guard';

@Controller('url')
export class UrlController {
  constructor(private readonly urlService: UrlService) {}

  @Get(':short')
  async redirectToOriginalUrl(@Param('short') short: string) {
    return this.urlService.redirectToOriginalUrl(short);
  }

  @Post()
  @UseGuards(AuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async generateShortUrl(@Body() createUrlDto: CreateUrlDto) {
    return this.urlService.generateShortUrl(createUrlDto);
  }

  @Post('custom')
  @UseGuards(AuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async generateCustomBackHalf(@Body() customBackHalfDto: CustomBackHalfDto) {
    return this.urlService.generateCustomBackHalf(customBackHalfDto);
  }

  @Get('history')
  @UseGuards(AuthGuard)
  async getHistory(@Query('userId') userId: string) {
    return this.urlService.getHistory(userId);
  }

  @Delete('delete/:id')
  @UseGuards(AuthGuard)
  async deleteUrl(@Param('id') id: string, @Body() deleteUrlDto: DeleteUrlDto) {
    return this.urlService.deleteUrl(id, deleteUrlDto);
  }

  @Get('export')
  @UseGuards(AuthGuard)
  async exportGeneratedUrls(@Query() exportUrlsDto: ExportUrlsDto) {
    return this.urlService.exportGeneratedUrls(exportUrlsDto);
  }

  @Get('filter/:category')
  @UseGuards(AuthGuard)
  async getFilteredCategory(@Param('category') category: string) {
    return this.urlService.getFilteredCategory(category);
  }

  @Put('filter')
  @UseGuards(AuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateCategory(@Body() updateCategoryDto: UpdateCategoryDto) {
    return this.urlService.updateCategory(updateCategoryDto);
  }
}

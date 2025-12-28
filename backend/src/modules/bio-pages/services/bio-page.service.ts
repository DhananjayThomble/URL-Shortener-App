import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BioPage } from '../entities/bio-page.entity';
import { CreateBioPageDto, UpdateBioPageDto } from '../dto';

@Injectable()
export class BioPageService {
  constructor(
    @InjectRepository(BioPage)
    private readonly bioPageRepository: Repository<BioPage>,
  ) {}

  async create(userId: string, createBioPageDto: CreateBioPageDto): Promise<BioPage> {
    // Check if user already has a bio page
    const existingBioPage = await this.bioPageRepository.findOne({
      where: { userId },
    });

    if (existingBioPage) {
      throw new ConflictException('User already has a bio page');
    }

    // Check username uniqueness
    await this.validateUsernameUniqueness(createBioPageDto.username);

    const bioPage = this.bioPageRepository.create({
      userId,
      ...createBioPageDto,
      theme: createBioPageDto.theme || 'default',
      backgroundColor: createBioPageDto.backgroundColor || '#ffffff',
      textColor: createBioPageDto.textColor || '#000000',
      buttonStyle: createBioPageDto.buttonStyle || 'rounded',
      isPublic: createBioPageDto.isPublic ?? true,
    });

    return await this.bioPageRepository.save(bioPage);
  }

  async findByUsername(username: string): Promise<BioPage> {
    const bioPage = await this.bioPageRepository.findOne({
      where: { username: username.toLowerCase() },
      relations: ['bioLinks'],
    });

    if (!bioPage) {
      throw new NotFoundException('Bio page not found');
    }

    // Filter only active bio links and sort by position
    if (bioPage.bioLinks) {
      bioPage.bioLinks = bioPage.bioLinks
        .filter((link) => link.isActive)
        .sort((a, b) => a.position - b.position);
    }

    return bioPage;
  }

  async findByUserId(userId: string): Promise<BioPage> {
    const bioPage = await this.bioPageRepository.findOne({
      where: { userId },
      relations: ['bioLinks'],
    });

    if (!bioPage) {
      throw new NotFoundException('Bio page not found');
    }

    // Sort bio links by position
    if (bioPage.bioLinks) {
      bioPage.bioLinks = bioPage.bioLinks.sort((a, b) => a.position - b.position);
    }

    return bioPage;
  }

  async update(
    userId: string,
    updateBioPageDto: UpdateBioPageDto,
  ): Promise<BioPage> {
    const bioPage = await this.bioPageRepository.findOne({
      where: { userId },
    });

    if (!bioPage) {
      throw new NotFoundException('Bio page not found');
    }

    // Apply theme customization
    const updatedBioPage = this.bioPageRepository.merge(bioPage, updateBioPageDto);

    return await this.bioPageRepository.save(updatedBioPage);
  }

  async delete(userId: string): Promise<void> {
    const bioPage = await this.bioPageRepository.findOne({
      where: { userId },
    });

    if (!bioPage) {
      throw new NotFoundException('Bio page not found');
    }

    await this.bioPageRepository.remove(bioPage);
  }

  async checkOwnership(userId: string, bioPageId: string): Promise<BioPage> {
    const bioPage = await this.bioPageRepository.findOne({
      where: { id: bioPageId },
    });

    if (!bioPage) {
      throw new NotFoundException('Bio page not found');
    }

    if (bioPage.userId !== userId) {
      throw new ForbiddenException('Access denied to this bio page');
    }

    return bioPage;
  }

  async validateUsernameUniqueness(username: string): Promise<void> {
    const existingBioPage = await this.bioPageRepository.findOne({
      where: { username: username.toLowerCase() },
    });

    if (existingBioPage) {
      throw new ConflictException('Username is already taken');
    }
  }

  async isUsernameAvailable(username: string): Promise<boolean> {
    const existingBioPage = await this.bioPageRepository.findOne({
      where: { username: username.toLowerCase() },
    });

    return !existingBioPage;
  }

  async getPublicBioPage(username: string): Promise<BioPage> {
    const bioPage = await this.findByUsername(username);

    if (!bioPage.isPublic) {
      throw new ForbiddenException('This bio page is private');
    }

    return bioPage;
  }

  async toggleVisibility(userId: string): Promise<BioPage> {
    const bioPage = await this.bioPageRepository.findOne({
      where: { userId },
    });

    if (!bioPage) {
      throw new NotFoundException('Bio page not found');
    }

    bioPage.isPublic = !bioPage.isPublic;
    return await this.bioPageRepository.save(bioPage);
  }

  async updateTheme(
    userId: string,
    themeData: {
      theme?: string;
      backgroundColor?: string;
      textColor?: string;
      buttonStyle?: string;
    },
  ): Promise<BioPage> {
    const bioPage = await this.bioPageRepository.findOne({
      where: { userId },
    });

    if (!bioPage) {
      throw new NotFoundException('Bio page not found');
    }

    // Apply theme customization
    if (themeData.theme) bioPage.theme = themeData.theme;
    if (themeData.backgroundColor) bioPage.backgroundColor = themeData.backgroundColor;
    if (themeData.textColor) bioPage.textColor = themeData.textColor;
    if (themeData.buttonStyle) bioPage.buttonStyle = themeData.buttonStyle;

    return await this.bioPageRepository.save(bioPage);
  }
}
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { BioLink } from '../entities/bio-link.entity';
import { BioPage } from '../entities/bio-page.entity';
import { CreateBioLinkDto, UpdateBioLinkDto, ReorderBioLinksDto } from '../dto';

@Injectable()
export class BioLinkService {
  constructor(
    @InjectRepository(BioLink)
    private readonly bioLinkRepository: Repository<BioLink>,
    @InjectRepository(BioPage)
    private readonly bioPageRepository: Repository<BioPage>,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    userId: string,
    bioPageId: string,
    createBioLinkDto: CreateBioLinkDto,
  ): Promise<BioLink> {
    // Verify bio page ownership
    await this.verifyBioPageOwnership(userId, bioPageId);

    // Get the next position
    const maxPosition = await this.bioLinkRepository
      .createQueryBuilder('bioLink')
      .select('MAX(bioLink.position)', 'maxPosition')
      .where('bioLink.bioPageId = :bioPageId', { bioPageId })
      .getRawOne();

    const nextPosition = (maxPosition?.maxPosition || 0) + 1;

    const bioLink = this.bioLinkRepository.create({
      bioPageId,
      ...createBioLinkDto,
      position: nextPosition,
      isActive: createBioLinkDto.isActive ?? true,
    });

    return await this.bioLinkRepository.save(bioLink);
  }

  async findAllByBioPageId(bioPageId: string): Promise<BioLink[]> {
    return await this.bioLinkRepository.find({
      where: { bioPageId },
      order: { position: 'ASC' },
    });
  }

  async findById(id: string): Promise<BioLink> {
    const bioLink = await this.bioLinkRepository.findOne({
      where: { id },
      relations: ['bioPage'],
    });

    if (!bioLink) {
      throw new NotFoundException('Bio link not found');
    }

    return bioLink;
  }

  async update(
    userId: string,
    id: string,
    updateBioLinkDto: UpdateBioLinkDto,
  ): Promise<BioLink> {
    const bioLink = await this.findById(id);
    
    // Verify ownership through bio page
    await this.verifyBioPageOwnership(userId, bioLink.bioPageId);

    const updatedBioLink = this.bioLinkRepository.merge(bioLink, updateBioLinkDto);
    return await this.bioLinkRepository.save(updatedBioLink);
  }

  async delete(userId: string, id: string): Promise<void> {
    const bioLink = await this.findById(id);
    
    // Verify ownership through bio page
    await this.verifyBioPageOwnership(userId, bioLink.bioPageId);

    const bioPageId = bioLink.bioPageId;
    const deletedPosition = bioLink.position;

    // Use transaction to ensure atomic operation
    await this.dataSource.transaction(async (manager) => {
      // Delete the bio link
      await manager.remove(bioLink);

      // Reorder remaining links to fill the gap
      await manager
        .createQueryBuilder()
        .update(BioLink)
        .set({ position: () => 'position - 1' })
        .where('bioPageId = :bioPageId AND position > :deletedPosition', {
          bioPageId,
          deletedPosition,
        })
        .execute();
    });
  }

  async reorderLinks(
    userId: string,
    bioPageId: string,
    reorderDto: ReorderBioLinksDto,
  ): Promise<BioLink[]> {
    // Verify bio page ownership
    await this.verifyBioPageOwnership(userId, bioPageId);

    // Verify all link IDs belong to this bio page
    const existingLinks = await this.bioLinkRepository.find({
      where: { bioPageId },
    });

    const existingLinkIds = existingLinks.map((link) => link.id);
    const invalidIds = reorderDto.linkIds.filter(
      (id) => !existingLinkIds.includes(id),
    );

    if (invalidIds.length > 0) {
      throw new BadRequestException(
        `Invalid link IDs: ${invalidIds.join(', ')}`,
      );
    }

    if (reorderDto.linkIds.length !== existingLinks.length) {
      throw new BadRequestException(
        'All bio links must be included in reorder operation',
      );
    }

    // Use transaction for atomic reordering
    await this.dataSource.transaction(async (manager) => {
      // Update positions based on the new order
      for (let i = 0; i < reorderDto.linkIds.length; i++) {
        await manager
          .createQueryBuilder()
          .update(BioLink)
          .set({ position: i + 1 })
          .where('id = :id', { id: reorderDto.linkIds[i] })
          .execute();
      }
    });

    // Return the reordered links
    return await this.findAllByBioPageId(bioPageId);
  }

  async toggleActive(userId: string, id: string): Promise<BioLink> {
    const bioLink = await this.findById(id);
    
    // Verify ownership through bio page
    await this.verifyBioPageOwnership(userId, bioLink.bioPageId);

    bioLink.isActive = !bioLink.isActive;
    return await this.bioLinkRepository.save(bioLink);
  }

  async moveUp(userId: string, id: string): Promise<BioLink[]> {
    const bioLink = await this.findById(id);
    
    // Verify ownership through bio page
    await this.verifyBioPageOwnership(userId, bioLink.bioPageId);

    if (bioLink.position === 1) {
      throw new BadRequestException('Link is already at the top');
    }

    // Use transaction for atomic position swap
    await this.dataSource.transaction(async (manager) => {
      // Find the link above
      const linkAbove = await manager.findOne(BioLink, {
        where: {
          bioPageId: bioLink.bioPageId,
          position: bioLink.position - 1,
        },
      });

      if (linkAbove) {
        // Swap positions
        const tempPosition = bioLink.position;
        bioLink.position = linkAbove.position;
        linkAbove.position = tempPosition;

        await manager.save([bioLink, linkAbove]);
      }
    });

    return await this.findAllByBioPageId(bioLink.bioPageId);
  }

  async moveDown(userId: string, id: string): Promise<BioLink[]> {
    const bioLink = await this.findById(id);
    
    // Verify ownership through bio page
    await this.verifyBioPageOwnership(userId, bioLink.bioPageId);

    // Check if it's already at the bottom
    const maxPosition = await this.bioLinkRepository
      .createQueryBuilder('bioLink')
      .select('MAX(bioLink.position)', 'maxPosition')
      .where('bioLink.bioPageId = :bioPageId', { bioPageId: bioLink.bioPageId })
      .getRawOne();

    if (bioLink.position >= maxPosition?.maxPosition) {
      throw new BadRequestException('Link is already at the bottom');
    }

    // Use transaction for atomic position swap
    await this.dataSource.transaction(async (manager) => {
      // Find the link below
      const linkBelow = await manager.findOne(BioLink, {
        where: {
          bioPageId: bioLink.bioPageId,
          position: bioLink.position + 1,
        },
      });

      if (linkBelow) {
        // Swap positions
        const tempPosition = bioLink.position;
        bioLink.position = linkBelow.position;
        linkBelow.position = tempPosition;

        await manager.save([bioLink, linkBelow]);
      }
    });

    return await this.findAllByBioPageId(bioLink.bioPageId);
  }

  private async verifyBioPageOwnership(
    userId: string,
    bioPageId: string,
  ): Promise<void> {
    const bioPage = await this.bioPageRepository.findOne({
      where: { id: bioPageId },
    });

    if (!bioPage) {
      throw new NotFoundException('Bio page not found');
    }

    if (bioPage.userId !== userId) {
      throw new ForbiddenException('Access denied to this bio page');
    }
  }
}
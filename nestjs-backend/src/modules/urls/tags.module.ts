import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tag } from './entities/tag.entity';
import { LinkTag } from './entities/link-tag.entity';
import { Link } from './entities/link.entity';
import { TagsController } from './controllers/tags.controller';
import { TagsService } from './services/tags.service';
import { TagAssociationService } from './services/tag-association.service';
import { TagRepository } from './repositories/tag.repository';
import { LinkTagRepository } from './repositories/link-tag.repository';
import { LinkRepository } from './repositories/link.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Tag, LinkTag, Link])],
  controllers: [TagsController],
  providers: [
    TagsService,
    TagAssociationService,
    TagRepository,
    LinkTagRepository,
    LinkRepository,
  ],
  exports: [
    TagsService,
    TagAssociationService,
    TagRepository,
    LinkTagRepository,
  ],
})
export class TagsModule {}
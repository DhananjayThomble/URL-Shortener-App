import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BioPage, BioLink } from './entities';
import { BioPageService, BioLinkService } from './services';
import { BioPagesController } from './controllers/bio-pages.controller';

@Module({
  imports: [TypeOrmModule.forFeature([BioPage, BioLink])],
  controllers: [BioPagesController],
  providers: [BioPageService, BioLinkService],
  exports: [BioPageService, BioLinkService],
})
export class BioPagesModule {}
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BioPage, BioLink } from './entities';
import { BioPageService, BioLinkService } from './services';
import { BioPagesController } from './controllers/bio-pages.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BioPage, BioLink]),
    AuthModule,
  ],
  controllers: [BioPagesController],
  providers: [BioPageService, BioLinkService],
  exports: [BioPageService, BioLinkService],
})
export class BioPagesModule {}
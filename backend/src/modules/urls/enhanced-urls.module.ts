import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

// Entities
import { Link } from './entities/link.entity';
import { GeoRule } from './entities/geo-rule.entity';
import { Tag } from './entities/tag.entity';
import { LinkTag } from './entities/link-tag.entity';

// Repositories
import { LinkRepository } from './repositories/link.repository';
import { GeoRuleRepository } from './repositories/geo-rule.repository';
import { TagRepository } from './repositories/tag.repository';
import { LinkTagRepository } from './repositories/link-tag.repository';

// Services
import { EnhancedLinksService } from './services/enhanced-links.service';
import { PasswordProtectionService } from './services/password-protection.service';
import { GeoTargetingService } from './services/geo-targeting.service';
import { DeviceDetectionService } from './services/device-detection.service';
import { UTMParameterService } from './services/utm-parameter.service';
import { TrackingPixelService } from './services/tracking-pixel.service';
import { IpGeolocationService } from './services/ip-geolocation.service';
import { TagsService } from './services/tags.service';
import { TagAssociationService } from './services/tag-association.service';

// Controllers
import { EnhancedLinksController, EnhancedRedirectController } from './controllers/enhanced-links.controller';
import { TagsController } from './controllers/tags.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Link,
      GeoRule,
      Tag,
      LinkTag,
    ]),
    ConfigModule,
  ],
  controllers: [
    EnhancedLinksController,
    EnhancedRedirectController,
    TagsController,
  ],
  providers: [
    // Repositories
    LinkRepository,
    GeoRuleRepository,
    TagRepository,
    LinkTagRepository,
    
    // Services
    EnhancedLinksService,
    PasswordProtectionService,
    GeoTargetingService,
    DeviceDetectionService,
    UTMParameterService,
    TrackingPixelService,
    IpGeolocationService,
    TagsService,
    TagAssociationService,
  ],
  exports: [
    EnhancedLinksService,
    PasswordProtectionService,
    GeoTargetingService,
    DeviceDetectionService,
    UTMParameterService,
    TrackingPixelService,
    IpGeolocationService,
    TagsService,
    TagAssociationService,
  ],
})
export class EnhancedUrlsModule {}
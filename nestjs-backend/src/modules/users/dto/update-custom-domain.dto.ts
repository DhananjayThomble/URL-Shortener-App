import { PartialType } from '@nestjs/swagger';
import { CreateCustomDomainDto } from './create-custom-domain.dto';

export class UpdateCustomDomainDto extends PartialType(CreateCustomDomainDto) {}
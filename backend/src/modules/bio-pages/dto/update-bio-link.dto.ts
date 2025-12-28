import { PartialType } from '@nestjs/mapped-types';
import { CreateBioLinkDto } from './create-bio-link.dto';

export class UpdateBioLinkDto extends PartialType(CreateBioLinkDto) {}
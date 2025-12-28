import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateBioPageDto } from './create-bio-page.dto';

export class UpdateBioPageDto extends PartialType(
  OmitType(CreateBioPageDto, ['username'] as const),
) {}
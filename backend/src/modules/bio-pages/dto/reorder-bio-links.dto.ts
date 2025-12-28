import { IsArray, IsUUID, ArrayMinSize } from 'class-validator';

export class ReorderBioLinksDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  linkIds: string[];
}
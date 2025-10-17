import { IsString, IsNotEmpty, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCustomDomainDto {
  @ApiProperty({
    description: 'Custom domain name',
    example: 'short.example.com',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(253)
  @Matches(
    /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9])*$/,
    { message: 'Invalid domain format' }
  )
  domain: string;
}
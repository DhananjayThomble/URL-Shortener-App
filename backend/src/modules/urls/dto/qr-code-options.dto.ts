import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class QRCodeColorDto {
  @ApiPropertyOptional({ example: '#000000' })
  @IsOptional()
  @IsString()
  dark?: string;

  @ApiPropertyOptional({ example: '#FFFFFF' })
  @IsOptional()
  @IsString()
  light?: string;
}

export class QRCodeOptionsDto {
  @ApiPropertyOptional({ example: 256, description: 'Pixel size of the QR code' })
  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(1024)
  size?: number;

  @ApiPropertyOptional({ example: 'png', enum: ['png', 'svg'] })
  @IsOptional()
  @IsIn(['png', 'svg'])
  format?: 'png' | 'svg';

  @ApiPropertyOptional({ example: 'M', enum: ['L', 'M', 'Q', 'H'] })
  @IsOptional()
  @IsIn(['L', 'M', 'Q', 'H'])
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';

  @ApiPropertyOptional({ example: 2, description: 'Margin around the QR code' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  margin?: number;

  @ApiPropertyOptional({ type: QRCodeColorDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => QRCodeColorDto)
  color?: QRCodeColorDto;
}

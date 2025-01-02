import { IsNotEmpty, IsInt, Min, Max } from 'class-validator';

export class FeedbackDto {
  @IsNotEmpty()
  message: string;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;
}

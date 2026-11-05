import { IsString, IsInt, Min, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class CompleteGameDto {
  // Accept both 'token' and 'sessionToken' from frontend
  @IsString()
  @IsOptional()
  token?: string;

  @IsString()
  @IsOptional()
  sessionToken?: string;

  @IsInt()
  @Min(0)
  @Transform(({ value }) => parseInt(value, 10))
  score: number;

  // Resolved token — whichever field was provided
  getToken(): string {
    return (this.token ?? this.sessionToken) as string;
  }
}

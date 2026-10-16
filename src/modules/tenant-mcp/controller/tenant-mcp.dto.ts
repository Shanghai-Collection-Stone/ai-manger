import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/** @keyword-en mcp-endpoint-dto, input-validation */
export class CreateMcpEndpointDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

/** @keyword-en mcp-endpoint-dto, input-validation */
export class UpdateMcpEndpointDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

/** @keyword-en mcp-key-dto, input-validation */
export class CreateMcpKeyDto extends CreateMcpEndpointDto {
  @IsArray() @ArrayMaxSize(32) @IsString({ each: true }) permissions!: string[];
  @IsOptional() @IsISO8601() expiresAt?: string | null;
}

/** @keyword-en mcp-key-dto, input-validation */
export class UpdateMcpKeyDto extends UpdateMcpEndpointDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  permissions?: string[];
  @IsOptional() @IsISO8601() expiresAt?: string | null;
}

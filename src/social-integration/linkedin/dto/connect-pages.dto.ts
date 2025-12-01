import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsArray, ArrayNotEmpty, IsNotEmpty } from "class-validator";

export class ConnectPagesBodyDto {
  @ApiProperty({ description: 'ID of the social account', example: 'sa_123abc' })
  @IsNotEmpty()
  @IsString()
  socialAccountId: string;

  @ApiProperty({
    description: 'Array of LinkedIn page URNs to connect (e.g. urn:li:organization:109376565)',
    example: ['urn:li:organization:109376565', 'urn:li:organization:22334455'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  pageUrns: string[];
}
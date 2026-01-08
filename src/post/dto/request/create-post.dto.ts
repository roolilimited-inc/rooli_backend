import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContentType } from '@generated/enums';
import { Type } from 'class-transformer';

export class ThreadItemDto {
  @ApiProperty({
    description: 'Text content of the thread item',
    example: 'This is a comment in the thread',
  })
  @IsNotEmpty()
  @IsString()
  content: string;

  @ApiPropertyOptional({
    description:
      'Optional media IDs attached to this thread item. Order may determine display order.',
    example: ['media_1', 'media_2'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  mediaIds?: string[];
}

export class CreatePostDto {
  @ApiProperty({
    description: 'Text content of the post',
    example: 'Launching our new product today 🚀',
  })
  @IsNotEmpty()
  @IsString()
  content: string;

  @ApiPropertyOptional({
    description: 'Type of content being posted',
    enum: ContentType,
    default: ContentType.POST,
  })
  @IsOptional()
  @IsEnum(ContentType)
  contentType?: ContentType = ContentType.POST;

  @ApiProperty({
    description: 'List of SocialProfile IDs this post should be published to',
    example: ['cl9abc123facebook_page_id', 'cl9xyz456linkedin_profile_id'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  socialProfileIds: string[];

  @ApiPropertyOptional({
    description:
      'Media IDs from Media Library (Cloudinary). Order determines carousel order.',
    example: ['media_1', 'media_2'],
    type: [String],
    default: [],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  mediaIds?: string[] = [];

  @ApiPropertyOptional({
    description:
      'ISO 8601 datetime string for when the post should be published',
    example: '2026-01-10T09:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional({
    description:
      'Whether the system should automatically determine the best posting time',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isAutoSchedule?: boolean;

  @ApiProperty({
    description: 'IANA timezone used for scheduling',
    example: 'Africa/Lagos',
    default: 'UTC',
  })
  @IsNotEmpty()
  @IsString()
  timezone: string = 'UTC';

  @ApiPropertyOptional({
    description: 'Campaign ID (Rocket plan feature) for grouping posts',
    example: 'cmp_123456',
  })
  @IsOptional()
  @IsString()
  campaignId?: string;

  @ApiPropertyOptional({
    description: 'Label IDs used for categorizing the post',
    example: ['lbl_marketing', 'lbl_launch'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labelIds?: string[];

  @ApiPropertyOptional({
    description: 'Whether the post requires approval before publishing',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  needsApproval?: boolean;

  @ApiPropertyOptional({
    description: 'The chain of replies for this post',
    type: [ThreadItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ThreadItemDto)
  @IsOptional()
  threads?: ThreadItemDto[];
}

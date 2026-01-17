import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { CreatePostDto } from './create-post.dto';

export class BulkCreatePostDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePostDto)
  posts: CreatePostDto[];
}

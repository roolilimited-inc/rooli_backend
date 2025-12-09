import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PaginationDto } from '@/common/dtos/pagination.dto';
import { ApprovalStatus } from '@generated/enums';

export class GetApprovalsFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ApprovalStatus, description: 'Filter by approval status' })
  @IsOptional()
  @IsEnum(ApprovalStatus)
  status?: ApprovalStatus;

  @ApiPropertyOptional({ description: 'Filter by post ID' })
  @IsOptional()
  @IsString()
  postId?: string;

  @ApiPropertyOptional({ description: 'Filter by requester ID' })
  @IsOptional()
  @IsString()
  requesterId?: string;

  @ApiPropertyOptional({ description: 'Filter by approver ID' })
  @IsOptional()
  @IsString()
  approverId?: string;
}

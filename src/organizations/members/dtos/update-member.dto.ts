import { IsOptional, IsBoolean, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMemberDto {
  @IsOptional()
  @IsString()
  roleId?: string;
 
  @ApiPropertyOptional({
    example: true,
    description: 'Flag to activate or deactivate the member',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: { canInvite: true, canManageBilling: false },
    description: 'Updated permissions as key-value pairs',
  })
  @IsOptional()
  permissions?: Record<string, boolean>;
}

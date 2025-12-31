import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsString, IsNotEmpty, Length, IsOptional, IsEmail, IsHexColor } from "class-validator";

export class CreateWorkspaceDto {
  @ApiProperty({ 
    description: 'The display name of the workspace', 
    example: 'Coca Cola Account',
    minLength: 2,
    maxLength: 50
  })
  @IsString()
  @IsNotEmpty()
  @Length(2, 50, { message: 'Workspace name must be between 2 and 50 characters' })
  name: string;


  @ApiPropertyOptional({ 
    description: 'Official client name for reporting (Agency Plan only)', 
    example: 'The Coca-Cola Company' 
  })
  @IsString()
  @IsOptional()
  clientName?: string;

  @ApiPropertyOptional({ 
    description: 'Current status of the client relationship', 
    example: 'Active',
    default: 'Active'
  })
  @IsString()
  @IsOptional()
  clientStatus?: string;

  @ApiPropertyOptional({ 
    description: 'Primary contact point for this workspace (e.g., the client email)', 
    example: 'marketing@coke.com' 
  })
  @IsEmail({}, { message: 'Client contact must be a valid email address' })
  @IsOptional()
  clientContact?: string;

  @ApiPropertyOptional({ 
    description: 'Brand color code for dashboard categorization', 
    example: '#FF0000' 
  })
  @IsHexColor({ message: 'Client color must be a valid hex code (e.g., #FF0000)' })
  @IsOptional()
  clientColor?: string;
}

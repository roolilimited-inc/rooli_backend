import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsUUID } from "class-validator";

export class AddWorkspaceMemberDto {
  @ApiProperty({ 
    description: 'The email address of the user to invite. They must already have a Rooli account.', 
    example: 'jane.doe@agency.com' 
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty()
  email: string;

  @ApiProperty({ 
    description: 'The ID of the Role to assign (Must be a WORKSPACE scoped role)', 
    example: 'cm4s...' 
  })
  @IsUUID('4', { message: 'Role ID must be a valid UUID' })
  @IsNotEmpty()
  roleId: string;
}
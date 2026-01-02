
import { IsEmail, IsNotEmpty} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InviteUserDto {
  @ApiProperty({
    example: 'jane.doe@example.com',
    description: 'Email address of the user to invite',
  })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'role_id_12345',
    description: 'RoleId to assign to the invited member',
  })
  @IsNotEmpty()
  roleId: string;
}
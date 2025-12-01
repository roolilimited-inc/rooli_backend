import { ApiProperty } from "@nestjs/swagger";

export class RefreshTokenRequestDto {
  @ApiProperty({
    description: 'The socialAccount Id',
    example: 'cgjysemm345',
    required: true,
  })
  socialAccountId: string;
}
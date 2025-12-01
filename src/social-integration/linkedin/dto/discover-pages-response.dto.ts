import { ApiProperty } from '@nestjs/swagger';

export class LinkedInCompanyPageDto {
  @ApiProperty({ example: 'pa_abc123', description: 'Local pageAccount id (if available)' })
  id: string;

  @ApiProperty({ example: 'urn:li:organization:109376565', description: 'LinkedIn URN for the organization' })
  urn: string;

  @ApiProperty({ example: 'Rooli', description: 'Display name of the company page' })
  name: string;

  @ApiProperty({ example: 'roolisocial', description: 'Vanity name (handle)', required: false })
  vanityName?: string;

  @ApiProperty({ example: 'ADMINISTRATOR', description: 'Role of the connected user for this page' })
  role: string;

  @ApiProperty({ example: 'urn:li:digitalmediaAsset:D4D0BAQHln2YTYUaxIg', description: 'Logo asset URN', required: false })
  logoUrl?: string;
}
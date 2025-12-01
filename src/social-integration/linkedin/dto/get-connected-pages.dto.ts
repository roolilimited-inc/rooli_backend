import { ApiProperty } from '@nestjs/swagger';

 class ConnectedPageMetadataDto {
  @ApiProperty({
    example: {
      linkedInPage: {
        id: '109376565',
        urn: 'urn:li:organization:109376565',
        name: 'Rooli',
        vanityName: 'roolisocial',
        role: 'ADMINISTRATOR',
      },
    },
    required: false,
    description: 'Stored LinkedIn metadata for this page',
  })
  linkedInPage?: any;

  @ApiProperty({
    example: {
      parentAccount: {
        id: 'cmilwuowv00001eialngkoup4',
        platformAccountId: 'PAGE-oaxV-EunJg',
      },
    },
    required: false,
  })
  parentAccount?: any;

}

export class ConnectedPageDto {
  @ApiProperty({ example: 'pa_abc123' })
  id: string;

  @ApiProperty({ example: 'cmilwuowv00001eialngkoup4' })
  socialAccountId: string;

  @ApiProperty({ example: 'Rooli' })
  name: string;

  @ApiProperty({
    example: 'urn:li:digitalmediaAsset:D4D0BAQHln2YTYUaxIg',
    description: 'URL/URN to the profile picture or logo',
    required: false,
  })
  profilePicture: string | null;

  @ApiProperty({
    example: '109376565',
    description: 'LinkedIn organization ID (platformPageId)',
  })
  platformPageId: string;

  @ApiProperty({
    example: null,
    description: 'Category for the page (if provided by LinkedIn)',
    nullable: true,
  })
  category: string | null;

  @ApiProperty({ example: '178423094938291', nullable: true })
  instagramBusinessId: string | null;

  @ApiProperty({ example: 'roolisocial', nullable: true })
  instagramUsername: string | null;

  @ApiProperty({
    example: 'Encrypted access token string',
    description: 'Access token stored internally (usually encrypted)',
  })
  accessToken: string;

  @ApiProperty({ example: '2025-11-30T16:04:21.535Z' })
  createdAt: Date;

  @ApiProperty({ example: '2025-12-01T11:46:46.183Z' })
  updatedAt: Date;

  @ApiProperty({
    type: ConnectedPageMetadataDto,
    nullable: true,
    description: 'Metadata returned from LinkedIn on initial connection',
  })
  metadata: any;
}

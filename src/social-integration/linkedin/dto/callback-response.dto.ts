import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ValidateNested, IsArray, IsString } from "class-validator";


 class PageDto {
  @ApiProperty({ example: 'urn:li:organization:109376565' })
  urn: string;

  @ApiProperty({ example: 'Rooli' })
  name: string;

  @ApiProperty({ example: 'roolisocial' })
  vanityName: string;

  @ApiProperty({ example: 'ADMINISTRATOR' })
  role: string;

  @ApiProperty({ example: 'urn:li:digitalmediaAsset:D4D0BAQHln2YTYUaxIg', required: false })
  logoUrl?: string;
}

 class SocialAccountDto {
  @ApiProperty({ example: 'cmilwuowv00001eialngkoup4' })
  id: string;

  @ApiProperty({ example: null, nullable: true })
  organizationId: string | null;

  @ApiProperty({ example: 'LINKEDIN' })
  platform: string;

  @ApiProperty({ example: 'PAGE-oaxV-EunJg' })
  platformAccountId: string;

  @ApiProperty({ example: 'nanret' })
  username: string;

  @ApiProperty({ example: 'Nanret Gungshik' })
  name: string;

  @ApiProperty({ example: 'Nanret Gungshik' })
  displayName: string;

  @ApiProperty({ example: 'urn:li:digitalmediaAsset:C4D03AQFNd8mFuZ4B9A', required: false })
  profileImage?: string;

  // Sensitive tokens — best to mask in examples
  @ApiProperty({ example: '<REDACTED_ACCESS_TOKEN>', required: false })
  accessToken?: string;

  @ApiProperty({ example: '<REDACTED_REFRESH_TOKEN>', required: false })
  refreshToken?: string;

  @ApiProperty({ example: '2026-12-01T11:47:45.168Z', required: false })
  refreshTokenExpiresAt?: string;

  @ApiProperty({ example: null, required: false })
  accessSecret?: string | null;

  @ApiProperty({ example: '2026-01-30T11:46:45.168Z', required: false })
  tokenExpiresAt?: string;

  @ApiProperty({ example: null, required: false })
  errorMessage?: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: '2025-12-01T11:46:46.169Z', required: false })
  lastSyncAt?: string;

  @ApiProperty({ example: '2025-11-30T16:04:21.535Z' })
  createdAt: string;

  @ApiProperty({ example: '2025-12-01T11:46:46.183Z' })
  updatedAt: string;

  @ApiProperty({ example: ['r_basicprofile', 'w_organization_social'], isArray: true })
  scopes: string[];

  @ApiProperty({
    description: 'Cached metadata including discovered pages',
    type: Object,
    example: {
      lastDiscoveredPages: [
        {
          urn: 'urn:li:organization:109376565',
          name: 'Rooli',
          role: 'ADMINISTRATOR',
          logoUrl: 'urn:li:digitalmediaAsset:D4D0BAQHln2YTYUaxIg',
          vanityName: 'roolisocial',
        },
      ],
    },
  })
  metadata: any;

  @ApiProperty({ example: 'PAGE' })
  accountType: string;

  @ApiProperty({ example: null, required: false })
  connectedById?: string | null;

  @ApiProperty({ example: null, required: false })
  lastPostedAt?: string | null;
}



export class CallbackResponseDto {
  @ApiProperty({ type: SocialAccountDto })
  socialAccount: SocialAccountDto;

  @ApiProperty({ type: [PageDto], description: 'Available pages discovered during connect' })
  availablePages: PageDto[];

  @ApiProperty({ example: 'PAGES', description: 'Connection type, e.g. PAGES or PROFILE' })
  connectionType: string;
}
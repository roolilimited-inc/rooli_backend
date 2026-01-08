import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MediaFolderDto {
  @ApiProperty({
    description: 'Unique ID of the folder',
    example: 'fld_123abc',
  })
  id: string;

  @ApiProperty({
    description: 'Workspace ID this folder belongs to',
    example: 'ws_123456',
  })
  workspaceId: string;

  @ApiProperty({
    description: 'Folder name',
    example: 'Campaign Assets',
  })
  name: string;

  @ApiPropertyOptional({
    description: 'Parent folder ID (null for root folders)',
    example: 'fld_parent_001',
  })
  parentId?: string;

  @ApiProperty({
    description: 'Folder creation timestamp',
    example: '2026-01-08T10:00:00.000Z',
  })
  createdAt: string;

  @ApiProperty({
    description: 'Folder last update timestamp',
    example: '2026-01-08T10:05:00.000Z',
  })
  updatedAt: string;
}

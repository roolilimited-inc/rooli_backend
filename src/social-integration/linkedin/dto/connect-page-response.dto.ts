import { ApiProperty } from "@nestjs/swagger";

 class ConnectedPageDto {
  @ApiProperty({ example: 'cmilwuowv00001eialngkoup4' })
  id: string;

  @ApiProperty({ example: 'urn:li:organization:109376565' })
  urn: string;

  @ApiProperty({ example: 'Rooli' })
  name: string;

  @ApiProperty({ example: 'Administrator' })
  role: string;

  @ApiProperty({ example: 'urn:li:digitalmediaAsset:eeeeeeeee' })
  logoUrl: string;

  @ApiProperty({ example: 'rooli' })
  vanityName: string

}

 class FailedPageDto {
  @ApiProperty({ example: 'urn:li:organization:999999' })
  id: string;

  @ApiProperty({ example: 'Page not found or insufficient permissions' })
  error: string;
}

export class ConnectPagesResultDto {
  @ApiProperty({ type: [ConnectedPageDto] })
  connectedPages: ConnectedPageDto[];

  @ApiProperty({ type: [FailedPageDto] })
  failedPages: FailedPageDto[];
}
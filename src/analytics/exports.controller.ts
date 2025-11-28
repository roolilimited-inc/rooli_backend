import { Controller, Get, Query, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { ExportService } from './services/export.service';



@Controller('exports')
export class ExportsController {
  constructor(private readonly exportService: ExportService) {}

  // @Get('analytics/:organizationId')
  // async exportAnalytics(
  //   @Param('organizationId') organizationId: string,
  //   @Query() query: any,
  //   @Res() res: Response,
  // ) {
  //   const buffer = await this.exportService.generateReport({
  //     format: query.format || 'excel',
  //     organizationId,
  //     startDate: query.startDate ? new Date(query.startDate) : undefined,
  //     endDate: query.endDate ? new Date(query.endDate) : undefined,
  //     platform: query.platform,
  //   });

  //   res.setHeader('Content-Type', this.getContentType(query.format));
  //   res.setHeader('Content-Disposition', `attachment; filename=analytics-report.${query.format || 'xlsx'}`);
  //   res.send(buffer);
  // }

  private getContentType(format: string): string {
    const types = {
      excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pdf: 'application/pdf',
      csv: 'text/csv',
    };
    return types[format] || 'application/octet-stream';
  }
}
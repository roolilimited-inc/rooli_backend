import {
  Controller,
  Get,
  Query,
  Param,
  Res,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { AnalyticsQueryDto } from './dtos/analytics-query.dto';
import { AiInsightsService } from './services/ai-insights.service';
import { AnalyticsService } from './services/analytics.service';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';

import { TopPostsQueryDto } from './dtos/top-posts-query.dto';
import { AnalyticsSummary } from './dtos/analytics-summary.dto';
import { PlatformPerformance } from './dtos/platform-performance.dto';
import { TimeSeriesData } from './dtos/time-series-data.dto';
import { ExportOptionsDto } from './dtos/export-options.dto';
import { ExportService } from './services/export.service';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly aiInsightsService: AiInsightsService,
    private readonly exportService: ExportService,
  ) {}

  /**
   * Generate AI-powered insights for the current user's organization
   */
  // @Get('ai-insights/generate/:organizationId')
  // @ApiOperation({ summary: 'Generate AI insights for an organization' })
  // @ApiResponse({
  //   status: 200,
  //   description: 'Insights generated successfully',
  //   schema: {
  //     example: [
  //       {
  //         type: 'warning',
  //         title: 'Low Engagement Rate',
  //         message:
  //           'Your engagement rate is 1.8%. Consider creating more interactive content.',
  //         confidence: 0.8,
  //         data: { engagementRate: 0.018 },
  //       },
  //       {
  //         type: 'recommendation',
  //         title: 'Optimal Posting Time',
  //         message: 'The best time to post is between 1-3 PM weekdays.',
  //         confidence: 0.6,
  //       },
  //     ],
  //   },
  // })
  // @ApiResponse({ status: 403, description: 'Organization access denied' })
  // async generateInsights(
  //   @Param('organizationId') organizationId: string,
  //   @Req() req: Request,
  // ) {
  //   // You can verify access here using req.user or a guard
  //   return this.aiInsightsService.generateInsights(organizationId);
  // }

  // @Get('summary/:organizationId')
  // @ApiOperation({ summary: 'Get analytics summary for an organization' })
  // @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  // async getSummary(
  //   @Param('organizationId') organizationId: string,
  //   @Query() query: AnalyticsQueryDto,
  // ): Promise<AnalyticsSummary> {
  //   return this.analyticsService.getOrganizationSummary(organizationId, query);
  // }

  // @Get('platforms/:organizationId')
  // @ApiOperation({ summary: 'Get analytics summary per platform' })
  // @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  // async getPlatforms(
  //   @Param('organizationId') organizationId: string,
  //   @Query() query: AnalyticsQueryDto,
  // ): Promise<PlatformPerformance[]> {
  //   return this.analyticsService.getPlatformPerformance(organizationId, query);
  // }

  // @Get('time-series/:organizationId')
  // @ApiOperation({ summary: 'Get time series analytics for charts' })
  // @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  // async getTimeSeries(
  //   @Param('organizationId') organizationId: string,
  //   @Query() query: AnalyticsQueryDto,
  // ): Promise<TimeSeriesData[]> {
  //   return this.analyticsService.getTimeSeriesData(organizationId, query);
  // }

  @Get('top-posts/:organizationId')
  @ApiOperation({ summary: 'Get top performing posts by metric' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({
    name: 'metric',
    description: 'Metric to rank posts by',
    required: false,
  })
  async getTopPosts(
    @Param('organizationId') organizationId: string,
    @Query() query: TopPostsQueryDto,
  ) {
    return this.analyticsService.getTopPosts(
      organizationId,
      query,
      query.metric,
    );
  }

  // @Get('analytics')
  // @ApiOperation({ summary: 'Export analytics report' })
  // @ApiResponse({
  //   status: 200,
  //   description: 'Returns the exported report as a file.',
  // })
  // async exportAnalytics(
  //   @Query() query: ExportOptionsDto,
  // ): Promise<StreamableFile> {
  //   const buffer = await this.exportService.generateReport(query);

  //   const contentType =
  //     query.format === 'pdf'
  //       ? 'application/pdf'
  //       : query.format === 'excel'
  //         ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  //         : 'text/csv';

  //   const fileName = `analytics_report.${query.format}`;

  //   return new StreamableFile(buffer, {
  //     type: contentType,
  //     disposition: `attachment; filename="${fileName}"`,
  //   });
  // }
}

import { Body, Controller, Param, Post } from '@nestjs/common';
import { AiService } from './service/ai.service';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RequireFeature } from '@/common/decorators/require-feature.decorator';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  // ===================================
  // 📢 1. VARIATIONS (Magic Button)
  // ===================================
  @Post('variations')
  async generateVariations(
    @CurrentUser() user: any,
    @Param('workspaceId') workspaceId: string,
    @Body('content') content: string
  ) {
    // Uses standard TEXT quota (checked inside service)
    return this.aiService.generateVariations(user, workspaceId, content);
  }

  // ===================================
  // ♻️ 2. REPURPOSER (Blog -> Thread)
  // ===================================
  // 🔒 Feature Gated: Only Business/Rocket plans usually get this
  @Post('repurpose')
  //@RequireFeature(Feature.AI_ADVANCED) 
  async repurposeContent(
    @CurrentUser() user: any,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: { url: string; type: 'THREAD' | 'ARTICLE' }
  ) {
    // Uses standard TEXT quota (checked inside service)
    return this.aiService.repurposeContent(user, workspaceId, dto.url, dto.type);
  }

  // ===================================
  // #️⃣ 3. HASHTAGS
  // ===================================
  @Post('hashtags')
  async generateHashtags(
    @CurrentUser() user: any,
    @Param('workspaceId') workspaceId: string,
    @Body('content') content: string
  ) {
    // Uses standard TEXT quota
    return this.aiService.generateHashtags(user, workspaceId, content);
  }
}

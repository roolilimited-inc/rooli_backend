import { Injectable, Logger } from '@nestjs/common';
import { IAiProvider } from '../interfaces/ai-provider.interface';
import { GeminiProvider } from '../providers/gemini.provider';
import { AiProvider } from '@generated/enums';
import { HuggingFaceProvider } from '../providers/hugging-face.provider';

@Injectable()
export class AiFactory {
  private readonly logger = new Logger(AiFactory.name);
  
  constructor(
 private gemini: GeminiProvider,       // 🚀 Prod: Imagen 3 (Paid)
    private huggingFace: HuggingFaceProvider
  ) {}

/**
   * 🏭 TEXT Provider Selector
   * Routes based on User Plan (e.g., Gemini for Free, Anthropic for Rocket)
   */
  getProvider(providerName: AiProvider): IAiProvider {
    switch (providerName) {
      case 'GEMINI':
        return this.gemini;
      // case 'ANTHROPIC': return this.anthropic; // Add later if needed
      default:
        return this.gemini; // Default fallback
    }
  }

  /**
   * 🎨 IMAGE Provider Selector
   * Routes based on Environment (Dev vs Prod) to save money.
   */
  getImageProvider(): IAiProvider {
  //   // 1. DEVELOPMENT MODE
  //   if (process.env.NODE_ENV === 'development') {
  //     this.logger.debug('🎨 Mode: DEV. Routing to Hugging Face (Free).');
  //     return this.huggingFace;
  //   }

  //   this.logger.log('🚀 Mode: PROD. Routing to Gemini Imagen 3 (Paid).');
  //   return this.gemini; 
  // }
  // Temporary: Always use Hugging Face for now to save costs
    this.logger.log('🎨 Routing all image generation to Hugging Face.');
    return this.huggingFace;
  }
}
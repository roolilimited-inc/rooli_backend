
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InferenceClient } from '@huggingface/inference';
import { IAiProvider, AiResponse, AiImageResponse } from '../interfaces/ai-provider.interface';

@Injectable()
export class HuggingFaceProvider implements IAiProvider {
  private readonly logger = new Logger(HuggingFaceProvider.name);
  private readonly hf: InferenceClient;

  private readonly IMAGE_MODEL =
    process.env.HF_IMAGE_MODEL ??
    'stabilityai/stable-diffusion-xl-base-1.0';

  // Hard timeout to avoid hanging requests
  private readonly REQUEST_TIMEOUT_MS = 30_000;

  constructor() {
    const apiKey = process.env.HF_API_KEY;
    if (!apiKey) {
      throw new Error('HF_API_KEY is not defined');
    }

    this.hf = new InferenceClient(apiKey);
  }

  // --------------------------------------------------
  // Text: Explicitly unsupported
  // --------------------------------------------------
  async generateText(): Promise<AiResponse> {
    throw new BadRequestException(
      'HuggingFaceProvider does not support text generation. Use GeminiProvider.',
    );
  }

  // --------------------------------------------------
  // 🚫 Vision: Explicitly unsupported
  // --------------------------------------------------
  async analyzeImage(): Promise<AiResponse> {
    throw new BadRequestException(
      'HuggingFaceProvider does not support image analysis. Use GeminiProvider.',
    );
  }

  // --------------------------------------------------
  // 🎨 Image Generation (Dev / MVP)
  // --------------------------------------------------
  async generateImage(prompt: string): Promise<AiImageResponse> {
    this.logger.log(
      `🎨 Generating image via Hugging Face (${this.IMAGE_MODEL})`,
    );

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.REQUEST_TIMEOUT_MS,
    );

    try {
      const blob = await this.hf.textToImage(
        {
          model: this.IMAGE_MODEL,
          inputs: prompt,
          parameters: {
            negative_prompt:
              'blurry, low quality, ugly, deformed, distorted',
          },
        },
        {
          signal: controller.signal,
        },
      );

      // DEV ONLY: Base64 response
      const arrayBuffer = await blob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const base64 = `data:image/png;base64,${buffer.toString('base64')}`;

      return {
        urls: [base64],
        cost: 0
      };
    } catch (err: any) {
      this.logger.error(err);

      if (err.name === 'AbortError') {
        throw new ServiceUnavailableException(
          'Image generation timed out. Try again.',
        );
      }

      const message = err?.message ?? '';

      // HF cold start
      if (message.includes('503')) {
        throw new ServiceUnavailableException(
          'AI model is waking up. Retry in a few seconds.',
        );
      }

      throw new BadRequestException(
        'Failed to generate image via Hugging Face.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

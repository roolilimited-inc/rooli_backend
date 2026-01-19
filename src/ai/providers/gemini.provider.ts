import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { IAiProvider, AiResponse, AiImageResponse } from '../interfaces/ai-provider.interface';
import axios from 'axios';

@Injectable()
export class GeminiProvider implements IAiProvider {
  private client: GoogleGenerativeAI;
  private logger = new Logger(GeminiProvider.name);
  
  // ⚙️ CONFIGURATION
  // Use 'gemini-2.5-flash' for stability or 'gemini-3-flash-preview' for smarts
  private readonly TEXT_MODEL = 'gemini-2.5-flash'; 
  
  // Imagen 3 requires a specific endpoint often accessed via REST if the SDK lags
  private readonly IMAGEN_MODEL = 'imagen-3.0-generate-001';

  constructor() {
    this.client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }

  // ===========================================================================
  // 📝 1. TEXT GENERATION (Free)
  // ===========================================================================
  async generateText(prompt: string, systemPrompt?: string, modelOverride?: string): Promise<AiResponse> {
    try {
      const modelName = modelOverride || this.TEXT_MODEL;
      
      const model = this.client.getGenerativeModel({ 
        model: modelName,
        systemInstruction: systemPrompt, // Native System Prompt Support
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        ]
      });

      const result = await model.generateContent(prompt);
      const response = await result.response;
      
      return {
        content: response.text(),
        usage: {
          // Gemini Free Tier doesn't return exact billing tokens, but we estimate
          inputTokens: prompt.length / 4, 
          outputTokens: response.text().length / 4, 
        },
      };

    } catch (error) {
      this.logger.error(`Gemini Text Error: ${error.message}`);
      // Handle the "Safety Filter" specifically so the frontend knows
      if (error.message?.includes('SAFETY')) {
         throw new BadRequestException('Content blocked by safety filters.');
      }
      throw error;
    }
  }

  // ===========================================================================
  // 👁️ 2. VISION / MULTIMODAL (Free)
  // "Look at this image and write a caption"
  // ===========================================================================
  async analyzeImage(prompt: string, imageBuffer: Buffer, mimeType: string): Promise<AiResponse> {
    try {
      const model = this.client.getGenerativeModel({ model: this.TEXT_MODEL });
      
      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: imageBuffer.toString('base64'),
            mimeType: mimeType
          }
        }
      ]);

      return {
        content: result.response.text(),
        usage: { inputTokens: 0, outputTokens: 0 }
      };
    } catch (error) {
      this.logger.error(`Gemini Vision Error: ${error.message}`);
      throw error;
    }
  }

  // ===========================================================================
  // 🎨 3. IMAGE GENERATION (Imagen 3 - PAID ~$0.04)
  // Note: The Node SDK support for Imagen is sometimes experimental.
  // We use direct REST fetch for reliability if SDK fails, or standard SDK if updated.
  // ===========================================================================
  async generateImage(prompt: string): Promise<AiImageResponse> {
    try {
      // Option A: Using the SDK (If your version supports Imagen)
      // const model = this.client.getGenerativeModel({ model: this.IMAGEN_MODEL });
      // const result = await model.generateContent(prompt); // Imagen returns weird formats usually
      
      // Option B: Direct REST API (More reliable for Imagen 3 specifically)
      // You need a Vertex AI Access Token for this usually, but let's try the AI Studio Key
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.IMAGEN_MODEL}:predict?key=${process.env.GEMINI_API_KEY}`;
      
      const response = await axios.post(url, {
        instances: [{ prompt: prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: '1:1'
        }
      });

      // Parse the specialized Imagen response
      // (Google returns base64 string usually)
      const base64Image = response.data.predictions[0].bytesBase64Encoded;
      const dataUrl = `data:image/png;base64,${base64Image}`;

      return {
        urls: [dataUrl], // In Prod, upload this Base64 to S3 immediately!
        cost: 0.04 // Estimated cost
      };

    } catch (error) {
      this.logger.error(`Imagen 3 Error: ${error.message}`);
      throw new BadRequestException('Failed to generate image with Google Imagen.');
    }
  }
}
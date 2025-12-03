import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ScheduledPost, PublishingResult } from '../interfaces/social-scheduler.interface';
import { HttpService } from '@nestjs/axios';

@Injectable()
export abstract class BasePlatformService {
  abstract readonly platform: string;
  
  protected readonly logger = new Logger(this.constructor.name);
  protected readonly http: HttpService;

  constructor(http: HttpService) {
    this.http = http;
  }

  abstract schedulePost(post: ScheduledPost): Promise<PublishingResult>;
  abstract publishImmediately(post: ScheduledPost): Promise<PublishingResult>;
  abstract deleteScheduledPost(postId: string, accessToken: string): Promise<boolean>;
  //abstract validateCredentials(accessToken: string): Promise<boolean>;
  
  protected handleError(error: any, operation: string, context: any): PublishingResult {
    const errorMessage = this.extractErrorMessage(error);
    this.logger.error(`Error during ${operation}: ${errorMessage}`);
    
    return {
      success: false,
      error: errorMessage,
    };
  }

  protected extractErrorMessage(error: any): string {
    if (error.response?.data?.error?.message) {
      return error.response.data.error.message;
    }
    if (error.message) {
      return error.message;
    }
    return 'Unknown error occurred';
  }

  protected async makeApiRequest<T>(
    request: () => Promise<T>,
    operation: string,
  ): Promise<T> {
    try {
      return await request();
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.logger.error(`API request failed for ${operation}: ${errorMessage}`);
      throw error;
    }
  }

  protected validateRequiredFields(
  post: Record<string, any>,
  requiredFields: string[],
): void {
  for (const field of requiredFields) {
    if (!post[field]) {
      throw new BadRequestException(
        `Required field '${field}' is missing for ${this.platform}`,
      );
    }
  }
}

  protected async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (attempt === maxRetries) {
          break;
        }
        
        const delay = baseDelay * Math.pow(2, attempt - 1);
        this.logger.warn(`Attempt ${attempt} failed, retrying in ${delay}ms:`, error.message);
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }
}
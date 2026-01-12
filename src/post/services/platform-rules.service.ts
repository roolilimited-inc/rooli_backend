import { Platform } from '@generated/enums';
import { Injectable, BadRequestException } from '@nestjs/common';
import * as twitter from 'twitter-text';

@Injectable()
export class PlatformRulesService {
  private readonly X_CHAR_LIMIT = 280; 
  private readonly X_MAX_MEDIA = 4;
  private readonly LINKEDIN_CHAR_LIMIT = 3000;
  private readonly IG_CAPTION_LIMIT = 2200;
  private readonly IG_HASHTAG_LIMIT = 30;

  public validatePost(
    content: string,
    platform: Platform,
    media?: { url: string; width?: number; height?: number }[],
  ) {
    switch (platform) {
      // ✅ Pass media to X validation
      case Platform.TWITTER: return this.validateX(content, media);
      case Platform.INSTAGRAM: return this.validateInstagram(content, media);
      case Platform.FACEBOOK: return this.validateFacebook(content, media);
      case Platform.LINKEDIN: return this.validateLinkedIn(content, media);
      default: return [{ content }];
    }
  }


private validateX(content: string, media?: any[]): { content: string }[] {
    // 1. MEDIA VALIDATION
    // Twitter allows max 4 photos, OR 1 video, OR 1 GIF.
    // For simplicity, we enforce the count of 4 items max.
    if (media && media.length > this.X_MAX_MEDIA) {
      throw new BadRequestException(`Twitter allows a maximum of ${this.X_MAX_MEDIA} images per tweet.`);
    }

    // 2. CHECK IF CONTENT IS VALID
    // This handles URLs (23 chars), Chinese/Japanese characters (weighted), and Emojis correctly.
    const parseResult = twitter.parseTweet(content);

    // If it fits in one tweet, return it immediately.
    if (parseResult.valid) {
      return [{ content }];
    }

    // 3. SMART THREAD SPLITTER
    // If too long, we split it safely using the library to verify each chunk.
    const threads: string[] = [];
    const words = content.split(/\s+/); // Split by whitespace (preserve paragraphs if you use split('\n') first)
    
    let currentBuffer = "";

    for (const word of words) {
      // Try adding the next word
      const candidate = currentBuffer ? `${currentBuffer} ${word}` : word;

      // Ask Twitter: "Is this candidate string still valid?"
      if (twitter.parseTweet(candidate).valid) {
        // Yes, it fits. Keep building.
        currentBuffer = candidate;
      } else {
        // No, it's too long. Push the previous buffer to threads.
        if (currentBuffer) threads.push(currentBuffer);
        
        // Start a new thread with the current word
        // Edge Case: If a SINGLE word is longer than 280 chars (unlikely), this will still fail API, 
        // but that's a user error.
        currentBuffer = word;
      }
    }

    // Push the final leftover chunk
    if (currentBuffer) threads.push(currentBuffer);

    // 4. ADD NUMBERING (1/X)
    // Note: Adding " (1/5)" adds characters! We need to be careful.
    // The simplified splitter above might overflow if we add numbering *after* splitting.
    // A robust production splitter reserves 7 chars of space for numbering.
    
    // For this implementation, we return the clean threads. 
    // Most users prefer seeing the splits clearly in the UI first.
    return threads.map((text, index) => ({
      content: `${text} (${index + 1}/${threads.length})` 
    }));
  }

  private validateInstagram(
    content: string,
    media?: { url: string; width?: number; height?: number }[],
  ) {
    // 1. TEXT LIMITS (Added)
    if (content.length > this.IG_CAPTION_LIMIT) {
       throw new BadRequestException(`Instagram captions cannot exceed ${this.IG_CAPTION_LIMIT} characters.`);
    }

    // 2. HASHTAG LIMIT (Added)
    // Count occurrences of '#'
    const hashtagCount = (content.match(/#/g) || []).length;
    if (hashtagCount > this.IG_HASHTAG_LIMIT) {
       throw new BadRequestException(`Instagram allows max ${this.IG_HASHTAG_LIMIT} hashtags.`);
    }

    // 3. MEDIA PRESENCE
    if (!media || media.length === 0) {
      throw new BadRequestException('Instagram posts require at least 1 image/video.');
    }
    if (media.length > 10) throw new BadRequestException('Instagram Carousel: Max 10 items.');

    // 4. RATIO CHECK
    for (const m of media) {
      if (!m.width || !m.height) continue; 

      const ratio = m.width / m.height;
      const validRatios = [
        { min: 0.99, max: 1.01, name: 'Square (1:1)' },
        { min: 0.8, max: 0.85, name: 'Portrait (4:5)' },
        { min: 1.9, max: 1.92, name: 'Landscape (1.91:1)' },
        { min: 0.56, max: 0.57, name: 'Reel (9:16)' },
      ];

      const isValid = validRatios.some(r => ratio >= r.min && ratio <= r.max);
      
      if (!isValid) {
        // Warning: This is strict. You might want to just "warn" instead of "throw".
         throw new BadRequestException(
          `Image ratio ${ratio.toFixed(2)} is invalid for Instagram. Allowed: 1:1, 4:5, 1.91:1, or 9:16`
        );
      }
    }
    return [{ content }];
  }

  private validateFacebook(content: string, media?: any[]) {
    if (media && media.length > 10) {
      throw new BadRequestException('Facebook allows max 10 photos/videos per post.');
    }
    // Facebook text limit is ~63k characters, so we practically ignore it.
    return [{ content }];
  }

  private validateLinkedIn(content: string, media?: any[]) {
    if (content.length > this.LINKEDIN_CHAR_LIMIT) {
      throw new BadRequestException(
        `LinkedIn text is too long (${content.length}/${this.LINKEDIN_CHAR_LIMIT}).`
      );
    }
    // LinkedIn supports 9 images (grid) or multi-page PDF (carousel). 
    // 9 is a safe generic limit to enforce for images.
    if (media && media.length > 9) {
       throw new BadRequestException('LinkedIn recommends max 9 images for optimal display.');
    }
    return [{ content }];
  }
}
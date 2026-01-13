import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TwitterApi } from 'twitter-api-v2';
import axios from 'axios';
import { ISocialProvider, SocialCredentials } from '../interfaces/social-provider.interface';

@Injectable()
export class TwitterProvider implements ISocialProvider {
  private readonly logger = new Logger(TwitterProvider.name);

  constructor(private configService: ConfigService) {}

  async publish(
    credentials: SocialCredentials,
    content: string,
    mediaFiles: { url: string; mimeType: string }[],
    metadata?: { replyToPostId?: string }
  ) {
    // 1. Initialize Client (OAuth 1.0a)
    // We mix Global App Keys with User Specific Tokens
    const client = new TwitterApi({
      appKey: this.configService.get('TWITTER_API_KEY'),
      appSecret: this.configService.get('TWITTER_API_SECRET'),
      accessToken: credentials.accessToken,
      accessSecret: credentials.accessSecret,
    });

    // We need the read-write client
    const rwClient = client.readWrite;

    try {
      // 2. Handle Media Uploads (The Hard Part)
      let mediaIds: string[] = [];
      
      if (mediaFiles.length > 0) {
        this.logger.log(`Uploading ${mediaFiles.length} media files to Twitter...`);
        
        // Upload all in parallel
        mediaIds = await Promise.all(
          mediaFiles.map((file) => this.uploadMedia(rwClient, file.url, file.mimeType))
        );
      }

      // 3. Prepare the Tweet Payload
      const payload: any = { text: content };

      // Attach Media
      if (mediaIds.length > 0) {
        payload.media = { media_ids: mediaIds };
      }

      // Attach Threading (Reply Logic)
      if (metadata?.replyToPostId) {
        payload.reply = { in_reply_to_tweet_id: metadata.replyToPostId };
      }

      // 4. Send the Tweet (v2 API)
      this.logger.log('Sending tweet...');
      const response = await rwClient.v2.tweet(payload);

      this.logger.log(`Tweet sent! ID: ${response.data.id}`);

      return {
        platformPostId: response.data.id,
        url: `https://twitter.com/user/status/${response.data.id}`,
      };

    } catch (error) {
      this.logger.error(`Twitter Publish Failed`, error);
      // Pass the error up so BullMQ handles retries
      throw new InternalServerErrorException(`Twitter Error: ${error.message}`);
    }
  }

  // ==================================================
  // 📸 HELPER: Download URL -> Upload to Twitter
  // ==================================================
  private async uploadMedia(client: TwitterApi, url: string, mimeType: string): Promise<string> {
    try {
      // A. Download the image/video from Cloudinary/S3
      const fileResponse = await axios.get(url, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(fileResponse.data);

      // B. Determine Upload Type
      // Twitter handles videos differently (chunked upload) than images.
      const isVideo = mimeType.startsWith('video');

      // C. Upload using v1.1 API (v2 doesn't support media upload yet)
      // .uploadMedia() automatically handles chunking for us!
      const mediaId = await client.v1.uploadMedia(buffer, {
        mimeType: mimeType, 
        target: isVideo ? 'tweet_video' : 'tweet_image'
      });

      return mediaId;
    } catch (error) {
      this.logger.error(`Failed to upload media from URL: ${url}`, error);
      throw new Error('Media Upload Failed');
    }
  }
}
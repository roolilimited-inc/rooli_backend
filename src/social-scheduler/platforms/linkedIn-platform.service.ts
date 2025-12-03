import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

import {
  ScheduledPost,
  PublishingResult,
  LinkedInScheduledPost,
} from '../interfaces/social-scheduler.interface';
import { BasePlatformService } from './base-platform.service';

@Injectable()
export class LinkedInPlatformService extends BasePlatformService {
  readonly platform = 'LINKEDIN';
  private readonly API_VERSION = '202401'; // Use a recent version
  private readonly BASE_URL = 'https://api.linkedin.com/rest';

  constructor(http: HttpService) {
    super(http);
  }

  // ===========================================================================
  // PUBLIC METHODS
  // ===========================================================================

  /**
   * We essentially just validate the token here.
   * We do NOT pre-upload assets because LinkedIn assets can expire if unused.
   */
  async schedulePost(post: LinkedInScheduledPost): Promise<PublishingResult> {
    return this.makeApiRequest(async () => {
      this.validatePost(post);
      // We return success to tell the Scheduler "Go ahead and queue this in BullMQ"
      // We don't return a containerId because we build it Just-In-Time.
      return { success: true };
    }, 'validate LinkedIn post');
  }

  async publishImmediately(post: LinkedInScheduledPost): Promise<PublishingResult> {
    return this.makeApiRequest(async () => {
      this.validatePost(post);
      const { accessToken, accountId, content, mediaUrls } = post;

      const authorUrn = this.formatAuthorUrn(accountId);

      // Upload Assets (Images/Videos)
      const assets: string[] = [];
      if (mediaUrls?.length) {
        this.logger.log(`Uploading ${mediaUrls.length} assets to LinkedIn...`);
        for (const url of mediaUrls) {
          const assetUrn = await this.handleMediaUpload(url, accessToken, authorUrn);
          if (assetUrn) assets.push(assetUrn);
        }
      }

      // Create the Post
      return await this.createPost(authorUrn, content, assets, accessToken);

    }, 'publish immediately to LinkedIn');
  }


  //this deletes the live post
  async deleteScheduledPost(postId: string, accessToken: string): Promise<boolean> {
    return this.makeApiRequest(async () => {
      if (!postId) throw new Error('Post ID (URN) is required');
      

      const urn = this.formatPostUrn(postId); 
      const encodedUrn = encodeURIComponent(urn);

      await firstValueFrom(
        this.http.delete(`${this.BASE_URL}/posts/${encodedUrn}`, {
          headers: this.getHeaders(accessToken),
        })
      );

      this.logger.log(`Deleted LinkedIn Post: ${postId}`);
      return true;
    }, 'delete LinkedIn post');
  }

  // ===========================================================================
  // POST CREATION LOGIC
  // ===========================================================================

  private async createPost(
    authorUrn: string,
    text: string,
    assetUrns: string[], // e.g. ["urn:li:image:...", "urn:li:video:..."]
    accessToken: string
  ): Promise<PublishingResult> {

    // 1. VALIDATE MEDIA TYPES
    const hasVideo = assetUrns.some(urn => urn.includes(':video:'));
    const hasImage = assetUrns.some(urn => urn.includes(':image:'));

    if (hasVideo && hasImage) {
      throw new Error('LinkedIn does not support mixing Photos and Videos in the same post.');
    }

    if (hasVideo && assetUrns.length > 1) {
      throw new Error('LinkedIn supports only ONE video per post.');
    }
    
    const postBody: any = {
      author: authorUrn,
      commentary: text || '',
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: []
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false
    };

    // Attach Media
    if (assetUrns.length > 0) {
      if (assetUrns.length === 1) {
        // Single Media
        const urn = assetUrns[0];
        if (urn.includes(':image:')) {
          postBody.content = { media: { id: urn } }; // Single Image
        } else if (urn.includes(':video:')) {
          postBody.content = { media: { id: urn } }; // Single Video
        }
      } else {
        // Multi-Image (Carousel is slightly different, but Multi-Image is standard)
        // Note: LinkedIn API v2 'posts' endpoint handles multi-image via 'multiImage' type
        postBody.content = {
          multiImage: {
            images: assetUrns.map(urn => ({ id: urn }))
          }
        };
      }
    }

    this.logger.log(`Creating LinkedIn Post for ${authorUrn}`);

    const response = await firstValueFrom(
      this.http.post(`${this.BASE_URL}/posts`, postBody, {
        headers: this.getHeaders(accessToken),
      })
    );

    // LinkedIn returns the ID in the 'x-linkedin-id' header or the body depending on version
    // Usually response.headers['x-restli-id'] or response.data.id
    const platformPostId = response.headers['x-restli-id'] || response.data?.id;

    if (!platformPostId) {
      throw new Error('Post created but no ID returned from LinkedIn');
    }

    return {
      success: true,
      platformPostId: platformPostId,
      publishedAt: new Date(),
      metadata: response.data
    };
  }

  // ===========================================================================
  // MEDIA UPLOAD WORKFLOW (3-Step Process)
  // ===========================================================================

  private async handleMediaUpload(url: string, accessToken: string, authorUrn: string): Promise<string> {
    const isVideo = this.detectMediaType(url) === 'video';
    const recipe = isVideo 
      ? 'urn:li:digitalmediaRecipe:feedshare-video' 
      : 'urn:li:digitalmediaRecipe:feedshare-image';

    // Step 1: Register Upload
    const registerResponse = await this.registerUpload(authorUrn, recipe, accessToken);
    const { uploadUrl, asset } = registerResponse;

    // Step 2: Stream Upload
    await this.uploadBinary(uploadUrl, url);

    // Step 3: Verify (Optional but recommended for videos)
    // For images, it's usually instant. For videos, you might need to wait.
    // We skip explicit polling here for speed, relying on LinkedIn's async processing.
    
    return asset; // Return the URN (urn:li:image:123...)
  }

  private async registerUpload(
    ownerUrn: string, 
    recipe: string, 
    accessToken: string
  ): Promise<{ uploadUrl: string; asset: string }> {
    
    const body = {
      registerUploadRequest: {
        recipes: [recipe],
        owner: ownerUrn,
        serviceRelationships: [
          {
            relationshipType: 'OWNER',
            identifier: 'urn:li:userGeneratedContent'
          }
        ]
      }
    };

    const actionUrl = `${this.BASE_URL}/images?action=initializeUpload`; // For images
    // Note: LinkedIn splits endpoints. 
    // Images -> /images?action=initializeUpload
    // Videos -> /videos?action=initializeUpload
    
    const endpoint = recipe.includes('video') 
      ? `${this.BASE_URL}/videos?action=initializeUpload`
      : `${this.BASE_URL}/images?action=initializeUpload`;

    const response = await firstValueFrom(
      this.http.post(endpoint, body, {
        headers: this.getHeaders(accessToken),
      })
    );

    const data = response.data.value;
    const uploadUrl = data.uploadUrl || data.uploadInstructions?.[0]?.uploadUrl;
    const asset = data.image || data.video; // Returns URN

    if (!uploadUrl || !asset) {
      throw new Error('Failed to register upload with LinkedIn');
    }

    return { uploadUrl, asset };
  }

  /**
   * Streams file from CDN to LinkedIn Upload URL
   */
  private async uploadBinary(uploadUrl: string, fileUrl: string): Promise<void> {
    this.logger.log(`Streaming binary to LinkedIn...`);

    // 1. Get Stream
    const fileStream = await this.http.axiosRef({
      url: fileUrl,
      method: 'GET',
      responseType: 'stream',
    });

    // 2. PUT Stream
    await this.http.axiosRef({
      url: uploadUrl,
      method: 'PUT', // LinkedIn uses PUT for binary uploads
      data: fileStream.data,
      headers: {
        'Content-Type': 'application/octet-stream',
        // LinkedIn strict requirement: Do NOT send Authorization header to the uploadUrl
        // It uses a signed URL.
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private getHeaders(accessToken: string) {
    return {
      'Authorization': `Bearer ${accessToken}`,
      'LinkedIn-Version': this.API_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
    };
  }

  private validatePost(post: any) {
    if (!post.accessToken) throw new Error('Access Token required');
    if (!post.accountId) throw new Error('LinkedIn Account ID (URN) required');
  }

  private formatPostUrn(id: string): string {
    if (id.startsWith('urn:li:share:') || id.startsWith('urn:li:ugcPost:')) return id;
    return `urn:li:share:${id}`; // Default fallback
  }

  private detectMediaType(url: string): 'video' | 'image' {
    const isVideo = url.match(/\.(mp4|mov|avi|mkv)$/i) || url.includes('video');
    return isVideo ? 'video' : 'image';
  }

  private formatAuthorUrn(id: string): string {
    // 1. If it already starts with 'urn:li:', trust the database (It's a Page)
    if (id.startsWith('urn:li:')) {
      return id;
    }

    // 2. If it's a raw ID, assume it is a Person (Profile)
    return `urn:li:person:${id}`;
  }
}
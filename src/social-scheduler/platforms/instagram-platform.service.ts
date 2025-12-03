import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { BasePlatformService } from './base-platform.service';
import {
  PublishingResult,
  MetaScheduledPost,
  InstagramPublishingResult,
} from '../interfaces/social-scheduler.interface';
import { ContentType } from '@generated/enums';

@Injectable()
export class InstagramPlatformService extends BasePlatformService {
  readonly platform = 'INSTAGRAM';
  private readonly GRAPH_API_URL = 'https://graph.facebook.com/v24.0';
  private readonly MAX_CAROUSEL_ITEMS = 10;
  private readonly MAX_POLL_ATTEMPTS = 3;
  private readonly INITIAL_POLL_DELAY_MS = 3000;
  private readonly MAX_POLL_DELAY_MS = 20000;
  POLLING_CONFIG: any;

  constructor(http: HttpService) {
    super(http);
  }

  async schedulePost(
    post: MetaScheduledPost,
  ): Promise<InstagramPublishingResult> {
    return this.handlePost(post);
  }

  async publishImmediately(
    post: MetaScheduledPost,
  ): Promise<InstagramPublishingResult> {
    const result = await this.handlePost(post);

    if (result.success && result.containerId) {
      return this.publishContainer(
        post.instagramBusinessId,
        result.containerId,
        post.accessToken,
      );
    }
    return result;
  }

  async deleteScheduledPost(
    containerId: string,
    accessToken: string,
  ): Promise<boolean> {
    return this.makeApiRequest(async () => {
      if (!containerId?.trim()) {
        throw new Error('Container ID is required for deletion');
      }
      if (!accessToken?.trim()) {
        throw new Error('Access token is required');
      }

      this.logger.log(`Deleting Instagram Container: ${containerId}`);

      await firstValueFrom(
        this.http.delete(`${this.GRAPH_API_URL}/${containerId}`, {
          params: { access_token: accessToken },
        }),
      );

      return true;
    }, 'delete Instagram container');
  }

  // ===========================================================================
  // STRATEGIES (Reel, Carousel, Single)
  // ===========================================================================

  private async handlePost(
    post: MetaScheduledPost,
  ): Promise<InstagramPublishingResult> {
    try {
      this.validateRequiredFields(post, ['accessToken', 'instagramBusinessId']);
      this.validateMediaUrls(post.mediaUrls);

      const { accessToken, instagramBusinessId, contentType } = post;
      const isReel = contentType === ContentType.REEL;
      const isCarousel = post.mediaUrls.length > 1;

      if (isReel) {
        return await this.handleReel(post, instagramBusinessId, accessToken);
      }

      if (isCarousel) {
        return await this.handleCarousel(
          post,
          instagramBusinessId,
          accessToken,
        );
      }

      return await this.handleSingleMedia(
        post,
        instagramBusinessId,
        accessToken,
      );
    } catch (error) {
      return this.handleError(error, 'Instagram Container Creation', {
        postId: post.id,
      });
    }
  }

  /**
   * Handles Mixed Media Carousels (Photos + Videos together)
   */
  private async handleCarousel(
    post: MetaScheduledPost,
    igUserId: string,
    accessToken: string,
  ): Promise<InstagramPublishingResult> {
    this.logger.log(
      `Creating Mixed Media Carousel (${post.mediaUrls.length} items)`,
    );

    // Create Child Containers (Parallel)
    // We loop through urls, detect type, and create specific item containers
    const childPromises = post.mediaUrls.map(async (url) => {
      const isVideo = await this.detectMediaType(url);
      return this.createCarouselItem(
        igUserId,
        url,
        accessToken,
        isVideo,
        post.metadata,
      );
    });

    const childIds = await Promise.all(childPromises);

    // Poll Children (Wait for videos to be ready)
    await this.pollMultipleContainers(childIds, accessToken);

    //  Create Parent Container
    const params: any = {
      access_token: accessToken,
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      caption: post.content || '',
    };

    // Apply Metadata (Location) to the Parent
    this.applyMetadata(params, post.metadata, false);

    const response = await this.makeApiRequest(
      () =>
        firstValueFrom(
          this.http.post(`${this.GRAPH_API_URL}/${igUserId}/media`, null, {
            params,
          }),
        ),
      'create carousel parent',
    );

    return {
      success: true,
      containerId: response.data.id,
      containerStatus: 'READY',
      mediaType: 'CAROUSEL',
    };
  }

  /**
   * Handles Single Photo or Video
   */
  private async handleSingleMedia(
    post: MetaScheduledPost,
    igUserId: string,
    accessToken: string,
  ): Promise<InstagramPublishingResult> {
    const url = post.mediaUrls[0];
    const isVideo = await this.detectMediaType(url);

    const params: any = {
      access_token: accessToken,
      caption: post.content || '',
    };

    if (isVideo) {
      params.media_type = 'VIDEO';
      params.video_url = url;
    } else {
      params.image_url = url;
      // User Tags only apply to Single Images
      this.applyMetadata(params, post.metadata, true);
    }

    // Location applies to both
    if (post.metadata?.locationId)
      params.location_id = post.metadata.locationId;

    const response = await this.makeApiRequest(
      () =>
        firstValueFrom(
          this.http.post(`${this.GRAPH_API_URL}/${igUserId}/media`, null, {
            params,
          }),
        ),
      'create single media',
    );

    const containerId = response.data.id;

    // Videos need polling before they can be published
    if (isVideo) {
      await this.pollMediaProcessing(containerId, accessToken);
    }

    return {
      success: true,
      containerId,
      mediaType: isVideo ? 'VIDEO' : 'IMAGE',
      containerStatus: 'READY',
    };
  }

  /**
   * Handles Reels
   */
  private async handleReel(
    post: MetaScheduledPost,
    igUserId: string,
    accessToken: string,
  ): Promise<InstagramPublishingResult> {
    if (post.mediaUrls.length !== 1)
      throw new Error('Reels support exactly one video.');

    const params: any = {
      access_token: accessToken,
      media_type: 'REELS',
      video_url: post.mediaUrls[0],
      caption: post.content || '',
      share_to_feed: post.metadata?.shareToFeed ?? true,
    };

    // Apply Reel-specific metadata
    if (post.metadata?.audioName) params.audio_name = post.metadata.audioName;
    if (post.metadata?.locationId)
      params.location_id = post.metadata.locationId;
    if (post.metadata?.coverUrl) params.cover_url = post.metadata.coverUrl; // Custom cover

    const response = await this.makeApiRequest(
      () =>
        firstValueFrom(
          this.http.post(`${this.GRAPH_API_URL}/${igUserId}/media`, null, {
            params,
          }),
        ),
      'create reel container',
    );

    await this.pollMediaProcessing(response.data.id, accessToken);

    return {
      success: true,
      containerId: response.data.id,
      mediaType: 'REEL',
      containerStatus: 'READY',
    };
  }

  // ===========================================================================
  // HELPERS (Uploads & Polling)
  // ===========================================================================

  private async createCarouselItem(
    igUserId: string,
    url: string,
    accessToken: string,
    isVideo: boolean,
    metadata: any,
  ): Promise<string> {
    const params: any = {
      access_token: accessToken,
      is_carousel_item: true,
    };

    if (isVideo) {
      params.media_type = 'VIDEO';
      params.video_url = url;
    } else {
      params.image_url = url;
      // Note: User Tags are NOT supported on carousel ITEMS via API currently,
      // only on single images or sometimes parent (platform dependent).
      // We skip tag application here to be safe.
    }

    const res = await this.makeApiRequest(
      () =>
        firstValueFrom(
          this.http.post(`${this.GRAPH_API_URL}/${igUserId}/media`, null, {
            params,
          }),
        ),
      'create carousel item',
    );
    return res.data.id;
  }

  private async publishContainer(
    igUserId: string,
    containerId: string,
    accessToken: string,
  ): Promise<PublishingResult> {
    this.logger.log(`Publishing Container: ${containerId}`);

    const response = await this.makeApiRequest(
      () =>
        firstValueFrom(
          this.http.post(
            `${this.GRAPH_API_URL}/${igUserId}/media_publish`,
            null,
            {
              params: { access_token: accessToken, creation_id: containerId },
            },
          ),
        ),
      'publish media',
    );

    return {
      success: true,
      platformPostId: response.data.id,
    };
  }

  // --- Metadata Helper ---
  private applyMetadata(params: any, metadata: any, allowUserTags: boolean) {
    if (!metadata) return;
    if (metadata.locationId) params.location_id = metadata.locationId;

    if (allowUserTags && metadata.userTags) {
      params.user_tags = JSON.stringify(metadata.userTags);
    }
  }

  // --- Polling Helpers (Simplified) ---
  private async pollMediaProcessing(containerId: string, accessToken: string) {
    let attempts = 0;
    while (attempts < this.POLLING_CONFIG.MAX_ATTEMPTS) {
      const status = await this.checkStatus(containerId, accessToken);
      if (status === 'FINISHED') return;
      if (status === 'ERROR')
        throw new Error('Media processing failed on Instagram side');

      attempts++;
      await new Promise((r) => setTimeout(r, this.POLLING_CONFIG.DELAY_MS));
    }
    throw new Error('Media processing timed out');
  }

  private async pollMultipleContainers(ids: string[], accessToken: string) {
    // Wait for all to be FINISHED
    await Promise.all(
      ids.map((id) => this.pollMediaProcessing(id, accessToken)),
    );
  }

  private async checkStatus(id: string, token: string): Promise<string> {
    const res = await firstValueFrom(
      this.http.get(`${this.GRAPH_API_URL}/${id}`, {
        params: { access_token: token, fields: 'status_code' },
      }),
    );
    return res.data.status_code;
  }

  // --- Validation Helpers ---
  private validateMediaUrls(urls?: string[]) {
    if (!urls?.length) throw new Error('No media URLs provided');
    if (urls.length > this.MAX_CAROUSEL_ITEMS)
      throw new Error(`Max ${this.MAX_CAROUSEL_ITEMS} items allowed`);
  }

  private async detectMediaType(url: string): Promise<boolean> {
    return url.match(/\.(mp4|mov|avi|mkv)$/i) !== null || url.includes('video');
  }

}

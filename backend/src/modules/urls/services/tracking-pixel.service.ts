import { Injectable, Logger } from '@nestjs/common';

export interface TrackingPixelConfig {
  metaPixelId?: string;
  googleAnalyticsId?: string;
  tiktokPixelId?: string;
}

export interface TrackingPixelData {
  eventType: 'page_view' | 'click' | 'conversion';
  url: string;
  referrer?: string;
  userAgent?: string;
  timestamp: Date;
  customData?: Record<string, any>;
}

export interface PixelFireResult {
  success: boolean;
  pixelType: string;
  pixelId: string;
  error?: string;
}

@Injectable()
export class TrackingPixelService {
  private readonly logger = new Logger(TrackingPixelService.name);

  /**
   * Generate tracking pixel HTML for embedding in redirect pages
   */
  generateTrackingPixelHTML(
    config: TrackingPixelConfig,
    data: TrackingPixelData,
  ): string {
    const pixels: string[] = [];

    // Meta (Facebook) Pixel
    if (config.metaPixelId) {
      pixels.push(this.generateMetaPixelHTML(config.metaPixelId, data));
    }

    // Google Analytics
    if (config.googleAnalyticsId) {
      pixels.push(this.generateGoogleAnalyticsHTML(config.googleAnalyticsId, data));
    }

    // TikTok Pixel
    if (config.tiktokPixelId) {
      pixels.push(this.generateTikTokPixelHTML(config.tiktokPixelId, data));
    }

    return pixels.join('\n');
  }

  /**
   * Generate server-side tracking pixel URLs for image-based tracking
   */
  generateTrackingPixelUrls(
    config: TrackingPixelConfig,
    data: TrackingPixelData,
  ): string[] {
    const urls: string[] = [];

    // Meta Pixel (server-side)
    if (config.metaPixelId) {
      urls.push(this.generateMetaPixelUrl(config.metaPixelId, data));
    }

    // Google Analytics (Measurement Protocol)
    if (config.googleAnalyticsId) {
      urls.push(this.generateGoogleAnalyticsUrl(config.googleAnalyticsId, data));
    }

    // TikTok Pixel (server-side)
    if (config.tiktokPixelId) {
      urls.push(this.generateTikTokPixelUrl(config.tiktokPixelId, data));
    }

    return urls;
  }

  /**
   * Fire tracking pixels server-side
   */
  async fireTrackingPixels(
    config: TrackingPixelConfig,
    data: TrackingPixelData,
  ): Promise<PixelFireResult[]> {
    const results: PixelFireResult[] = [];

    // Fire Meta Pixel
    if (config.metaPixelId) {
      const result = await this.fireMetaPixel(config.metaPixelId, data);
      results.push(result);
    }

    // Fire Google Analytics
    if (config.googleAnalyticsId) {
      const result = await this.fireGoogleAnalytics(config.googleAnalyticsId, data);
      results.push(result);
    }

    // Fire TikTok Pixel
    if (config.tiktokPixelId) {
      const result = await this.fireTikTokPixel(config.tiktokPixelId, data);
      results.push(result);
    }

    return results;
  }

  /**
   * Generate Meta (Facebook) Pixel HTML
   */
  private generateMetaPixelHTML(pixelId: string, data: TrackingPixelData): string {
    const eventData = JSON.stringify({
      event_name: this.mapEventTypeToMeta(data.eventType),
      event_time: Math.floor(data.timestamp.getTime() / 1000),
      event_source_url: data.url,
      custom_data: data.customData || {},
    });

    return `
<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');
fbq('track', '${this.mapEventTypeToMeta(data.eventType)}', ${JSON.stringify(data.customData || {})});
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${pixelId}&ev=${this.mapEventTypeToMeta(data.eventType)}&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->`;
  }

  /**
   * Generate Google Analytics HTML
   */
  private generateGoogleAnalyticsHTML(trackingId: string, data: TrackingPixelData): string {
    return `
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${trackingId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${trackingId}', {
    page_title: document.title,
    page_location: '${data.url}',
    page_referrer: '${data.referrer || ''}',
    custom_map: ${JSON.stringify(data.customData || {})}
  });
  gtag('event', '${this.mapEventTypeToGA(data.eventType)}', {
    event_category: 'url_shortener',
    event_label: '${data.url}',
    value: 1
  });
</script>
<!-- End Google Analytics -->`;
  }

  /**
   * Generate TikTok Pixel HTML
   */
  private generateTikTokPixelHTML(pixelId: string, data: TrackingPixelData): string {
    return `
<!-- TikTok Pixel Code -->
<script>
!function (w, d, t) {
  w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
  ttq.load('${pixelId}');
  ttq.page();
  ttq.track('${this.mapEventTypeToTikTok(data.eventType)}', ${JSON.stringify(data.customData || {})});
}(window, document, 'ttq');
</script>
<!-- End TikTok Pixel Code -->`;
  }

  /**
   * Generate Meta Pixel URL for server-side tracking
   */
  private generateMetaPixelUrl(pixelId: string, data: TrackingPixelData): string {
    const params = new URLSearchParams({
      id: pixelId,
      ev: this.mapEventTypeToMeta(data.eventType),
      dl: data.url,
      rl: data.referrer || '',
      ts: Math.floor(data.timestamp.getTime() / 1000).toString(),
      noscript: '1',
    });

    return `https://www.facebook.com/tr?${params.toString()}`;
  }

  /**
   * Generate Google Analytics URL for Measurement Protocol
   */
  private generateGoogleAnalyticsUrl(trackingId: string, data: TrackingPixelData): string {
    const params = new URLSearchParams({
      v: '1', // Version
      tid: trackingId, // Tracking ID
      cid: this.generateClientId(), // Client ID
      t: 'event', // Hit Type
      ec: 'url_shortener', // Event Category
      ea: this.mapEventTypeToGA(data.eventType), // Event Action
      el: data.url, // Event Label
      ev: '1', // Event Value
      dr: data.referrer || '', // Document Referrer
      ua: data.userAgent || '', // User Agent
    });

    return `https://www.google-analytics.com/collect?${params.toString()}`;
  }

  /**
   * Generate TikTok Pixel URL for server-side tracking
   */
  private generateTikTokPixelUrl(pixelId: string, data: TrackingPixelData): string {
    // TikTok uses a more complex server-side API
    // This is a simplified version - in production, you'd use their Events API
    const params = new URLSearchParams({
      pixel_code: pixelId,
      event: this.mapEventTypeToTikTok(data.eventType),
      timestamp: Math.floor(data.timestamp.getTime() / 1000).toString(),
      event_source_url: data.url,
    });

    return `https://analytics.tiktok.com/api/v2/pixel/track/?${params.toString()}`;
  }

  /**
   * Fire Meta Pixel server-side
   */
  private async fireMetaPixel(pixelId: string, data: TrackingPixelData): Promise<PixelFireResult> {
    try {
      const url = this.generateMetaPixelUrl(pixelId, data);
      
      // In a production environment, you would make an HTTP request to this URL
      // For now, we'll just log it
      this.logger.log(`Meta Pixel fired: ${url}`);
      
      return {
        success: true,
        pixelType: 'meta',
        pixelId,
      };
    } catch (error) {
      this.logger.error(`Error firing Meta Pixel: ${error.message}`);
      return {
        success: false,
        pixelType: 'meta',
        pixelId,
        error: error.message,
      };
    }
  }

  /**
   * Fire Google Analytics server-side
   */
  private async fireGoogleAnalytics(trackingId: string, data: TrackingPixelData): Promise<PixelFireResult> {
    try {
      const url = this.generateGoogleAnalyticsUrl(trackingId, data);
      
      // In a production environment, you would make an HTTP request to this URL
      this.logger.log(`Google Analytics fired: ${url}`);
      
      return {
        success: true,
        pixelType: 'google_analytics',
        pixelId: trackingId,
      };
    } catch (error) {
      this.logger.error(`Error firing Google Analytics: ${error.message}`);
      return {
        success: false,
        pixelType: 'google_analytics',
        pixelId: trackingId,
        error: error.message,
      };
    }
  }

  /**
   * Fire TikTok Pixel server-side
   */
  private async fireTikTokPixel(pixelId: string, data: TrackingPixelData): Promise<PixelFireResult> {
    try {
      const url = this.generateTikTokPixelUrl(pixelId, data);
      
      // In a production environment, you would use TikTok's Events API
      this.logger.log(`TikTok Pixel fired: ${url}`);
      
      return {
        success: true,
        pixelType: 'tiktok',
        pixelId,
      };
    } catch (error) {
      this.logger.error(`Error firing TikTok Pixel: ${error.message}`);
      return {
        success: false,
        pixelType: 'tiktok',
        pixelId,
        error: error.message,
      };
    }
  }

  /**
   * Map event types to Meta Pixel events
   */
  private mapEventTypeToMeta(eventType: string): string {
    const mapping: { [key: string]: string } = {
      page_view: 'PageView',
      click: 'ViewContent',
      conversion: 'Purchase',
    };
    return mapping[eventType] || 'PageView';
  }

  /**
   * Map event types to Google Analytics events
   */
  private mapEventTypeToGA(eventType: string): string {
    const mapping: { [key: string]: string } = {
      page_view: 'page_view',
      click: 'click',
      conversion: 'conversion',
    };
    return mapping[eventType] || 'page_view';
  }

  /**
   * Map event types to TikTok Pixel events
   */
  private mapEventTypeToTikTok(eventType: string): string {
    const mapping: { [key: string]: string } = {
      page_view: 'ViewContent',
      click: 'ClickButton',
      conversion: 'CompletePayment',
    };
    return mapping[eventType] || 'ViewContent';
  }

  /**
   * Generate a client ID for Google Analytics
   */
  private generateClientId(): string {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }

  /**
   * Validate tracking pixel configuration
   */
  validateTrackingPixelConfig(config: TrackingPixelConfig): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Validate Meta Pixel ID
    if (config.metaPixelId && !/^\d+$/.test(config.metaPixelId)) {
      errors.push('Meta Pixel ID must be numeric');
    }

    // Validate Google Analytics ID
    if (config.googleAnalyticsId && !/^(UA-\d+-\d+|G-[A-Z0-9]+)$/.test(config.googleAnalyticsId)) {
      errors.push('Google Analytics ID must be in format UA-XXXXXXX-X or G-XXXXXXXXXX');
    }

    // Validate TikTok Pixel ID
    if (config.tiktokPixelId && !/^[A-Z0-9]+$/.test(config.tiktokPixelId)) {
      errors.push('TikTok Pixel ID must be alphanumeric');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get supported tracking pixel providers
   */
  getSupportedProviders(): string[] {
    return ['meta', 'google_analytics', 'tiktok'];
  }
}
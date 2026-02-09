/**
 * Image preloading service for better performance
 * Preloads images into browser cache before they're displayed
 */

class ImageCacheService {
  private cache = new Map<string, boolean>();
  private preloadQueue: Set<string> = new Set();
  private isProcessing = false;

  /**
   * Preload a single image
   */
  async preloadImage(url: string): Promise<void> {
    if (this.cache.has(url) || this.preloadQueue.has(url)) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.preloadQueue.add(url);

      const img = new Image();
      img.onload = () => {
        this.cache.set(url, true);
        this.preloadQueue.delete(url);
        resolve();
      };
      img.onerror = () => {
        this.preloadQueue.delete(url);
        reject(new Error(`Failed to load image: ${url}`));
      };
      img.src = url;
    });
  }

  /**
   * Preload multiple images in parallel (with concurrency limit)
   */
  async preloadImages(urls: string[], maxConcurrent = 6): Promise<void> {
    const uniqueUrls = [...new Set(urls)].filter(url => !this.cache.has(url));

    if (uniqueUrls.length === 0) return;

    // Process in batches
    for (let i = 0; i < uniqueUrls.length; i += maxConcurrent) {
      const batch = uniqueUrls.slice(i, i + maxConcurrent);
      await Promise.allSettled(batch.map(url => this.preloadImage(url)));
    }
  }

  /**
   * Check if an image is cached
   */
  isCached(url: string): boolean {
    return this.cache.has(url);
  }

  /**
   * Clear the cache (useful for memory management)
   */
  clearCache(): void {
    this.cache.clear();
    this.preloadQueue.clear();
  }

  /**
   * Get cache stats
   */
  getStats(): { cached: number; queue: number } {
    return {
      cached: this.cache.size,
      queue: this.preloadQueue.size,
    };
  }
}

// Singleton instance
export const imageCache = new ImageCacheService();

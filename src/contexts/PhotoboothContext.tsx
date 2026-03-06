import { createContext, useContext, useState, useCallback, useEffect, ReactNode, useRef } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { Frame, FrameZone } from '../types/frame';
import { OverlayLayer } from '../types/overlay';
import { PlacedImage, ImageTransform } from '../types/collage';
import { DEFAULT_TRANSFORM } from '../types/collage';
import { applyZoneClipPath } from '../utils/canvasShapeClip';
import { LRUCache } from '../utils/lruCache';
import { createLogger } from '../utils/logger';

const logger = createLogger('PhotoboothContext');

export interface PhotoboothCanvasSize {
  width: number;
  height: number;
  name: string;
  isCustom?: boolean;
  createdAt?: string;
}

export interface PhotoboothBackgroundTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface PhotoboothContextType {
  // Photobooth-specific canvas state (separate from CollageContext)
  photoboothCanvasSize: PhotoboothCanvasSize | null;
  setPhotoboothCanvasSize: (size: PhotoboothCanvasSize | null) => void;
  photoboothBackground: string | null;
  setPhotoboothBackground: (bg: string | null) => void;
  photoboothBackgroundTransform: PhotoboothBackgroundTransform;
  setPhotoboothBackgroundTransform: (transform: PhotoboothBackgroundTransform) => void;
  photoboothOverlays: OverlayLayer[];
  setPhotoboothOverlays: (overlays: OverlayLayer[]) => void;
  photoboothAutoMatchBackground: boolean;
  setPhotoboothAutoMatchBackground: (enabled: boolean) => void;
  photoboothBackgroundDimensions: { width: number; height: number } | null;
  setPhotoboothBackgroundDimensions: (dims: { width: number; height: number } | null) => void;

  // Frame state (moved from CollageContext)
  photoboothFrame: Frame | null;
  setPhotoboothFrame: (frame: Frame | null) => void;

  // Finalize mode state
  finalizeViewMode: 'capture' | 'finalize';
  setFinalizeViewMode: (mode: 'capture' | 'finalize') => void;
  finalizeEditingZoneId: string | null;
  setFinalizeEditingZoneId: (zoneId: string | null) => void;

  // Custom set selection state
  selectedCustomSetId: string | null;
  setSelectedCustomSetId: (id: string | null) => void;

  // Placed images state (for finalize view)
  placedImages: Map<string, PlacedImage>;
  setPlacedImages: (images: Map<string, PlacedImage>) => void;
  updatePlacedImage: (zoneId: string, updates: Partial<PlacedImage>) => void;

  // Track if collage has been modified since last export
  collageIsDirty: boolean;
  setCollageIsDirty: (dirty: boolean) => void;
  resetCollageDirtyState: () => void;

  // Shared generating state - prevents concurrent print/upload operations
  isGeneratingCollage: boolean;
  setIsGeneratingCollage: (generating: boolean) => void;

  // Export function
  exportPhotoboothCanvasAsPNG: () => Promise<{ bytes: Uint8Array; filename: string } | null>;

  // Current collage filename — shared between print and upload; reset on finalize exit
  currentCollageFilename: string | null;
  setCurrentCollageFilename: (filename: string | null) => void;
}

const PhotoboothContext = createContext<PhotoboothContextType | undefined>(undefined);

const DEFAULT_BACKGROUND_TRANSFORM: PhotoboothBackgroundTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

export function PhotoboothProvider({ children }: { children: ReactNode }) {
  const [photoboothCanvasSize, setPhotoboothCanvasSize] = useState<PhotoboothCanvasSize | null>(null);
  const [photoboothBackground, setPhotoboothBackground] = useState<string | null>(null);
  const [photoboothBackgroundTransform, setPhotoboothBackgroundTransform] = useState<PhotoboothBackgroundTransform>(DEFAULT_BACKGROUND_TRANSFORM);
  const [photoboothOverlays, setPhotoboothOverlays] = useState<OverlayLayer[]>([]);
  const [photoboothAutoMatchBackground, setPhotoboothAutoMatchBackground] = useState(false);
  const [photoboothBackgroundDimensions, setPhotoboothBackgroundDimensions] = useState<{ width: number; height: number } | null>(null);
  const [photoboothFrame, setPhotoboothFrame] = useState<Frame | null>(null);
  const [finalizeViewMode, setFinalizeViewModeRaw] = useState<'capture' | 'finalize'>('capture');
  const [finalizeEditingZoneId, setFinalizeEditingZoneId] = useState<string | null>(null);
  const [selectedCustomSetId, setSelectedCustomSetId] = useState<string | null>(null);
  const [placedImages, setPlacedImages] = useState<Map<string, PlacedImage>>(new Map());
  const [currentCollageFilename, setCurrentCollageFilename] = useState<string | null>(null);
  const [collageIsDirty, setCollageIsDirty] = useState<boolean>(false);
  const [isGeneratingCollage, setIsGeneratingCollage] = useState<boolean>(false);

  // Wrap setFinalizeViewMode to reset collage filename and dirty state when exiting finalize
  const setFinalizeViewMode = useCallback((mode: 'capture' | 'finalize') => {
    setFinalizeViewModeRaw(mode);
    if (mode === 'capture') {
      setCurrentCollageFilename(null);
      setCollageIsDirty(false);
    }
  }, []);

  // Reset dirty state when explicitly called (after export)
  const resetCollageDirtyState = useCallback(() => {
    setCollageIsDirty(false);
  }, []);

  // Helper: Update a placed image
  const updatePlacedImage = useCallback((zoneId: string, updates: Partial<PlacedImage>) => {
    logger.debug('[updatePlacedImage] Called with zoneId:', zoneId, 'updates:', updates);
    setPlacedImages(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(zoneId);
      if (existing) {
        newMap.set(zoneId, { ...existing, ...updates });
        // Mark as dirty when transform changes (user moved/zoomed the image)
        if (updates.transform !== undefined) {
          logger.debug('[updatePlacedImage] Transform changed, setting dirty=true');
          setCollageIsDirty(true);
        }
      }
      return newMap;
    });
  }, []);

  // Image cache to avoid redundant fetches - LRU cache with max 500 images to prevent memory leaks
  const imageCache = useRef<LRUCache<string, HTMLImageElement>>(new LRUCache(500));

  // Helper: Load an image element from a source URL (with caching)
  const loadImage = useCallback((src: string): Promise<HTMLImageElement> => {
    // Check cache first
    const cached = imageCache.current.get(src);
    if (cached && cached.complete) {
      return Promise.resolve(cached);
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        imageCache.current.set(src, img);
        resolve(img);
      };
      img.onerror = reject;
      img.src = src;
    });
  }, []);

  // Helper: Load an image with fetch+objectURL fallback for CORS
  const loadImageWithFallback = useCallback(async (src: string): Promise<HTMLImageElement> => {
    // Check cache first
    const cached = imageCache.current.get(src);
    if (cached && cached.complete) {
      return cached;
    }

    // Also cache the fetch variant
    const fetchKey = `fetch:${src}`;
    const fetchCached = imageCache.current.get(fetchKey);
    if (fetchCached && fetchCached.complete) {
      return fetchCached;
    }

    try {
      return await loadImage(src);
    } catch {
      const resp = await fetch(src);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const img = await loadImage(url);
      // Cache with fetch key so subsequent loads don't create new object URLs
      imageCache.current.set(fetchKey, img);
      URL.revokeObjectURL(url);
      return img;
    }
  }, [loadImage]);

  // Export photobooth canvas as full-resolution PNG (optimized with parallel loading and toBlob)
  const exportPhotoboothCanvasAsPNG = useCallback(async (): Promise<{ bytes: Uint8Array; filename: string } | null> => {
    try {
      const frame = photoboothFrame;
      if (!frame) {
        logger.error('No photobooth frame available for export');
        return null;
      }

      // Wait for placed images to be loaded (avoid race condition with auto-placement)
      if (placedImages.size === 0) {
        logger.warn('[export] No placed images yet, skipping export');
        return null;
      }

      // Calculate canvas dimensions
      const canvasWidth = photoboothAutoMatchBackground && photoboothBackgroundDimensions
        ? photoboothBackgroundDimensions.width
        : photoboothCanvasSize?.width ?? frame.width;
      const canvasHeight = photoboothAutoMatchBackground && photoboothBackgroundDimensions
        ? photoboothBackgroundDimensions.height
        : photoboothCanvasSize?.height ?? frame.height;

      // Check if background is a solid color
      const isSolidColor = photoboothBackground ? /^#([0-9A-F]{3}){1,2}$/i.test(photoboothBackground) : false;

      // Convert background path to displayable URL
      const bgSrc = (photoboothBackground && !isSolidColor && !photoboothBackground.startsWith('http') && !photoboothBackground.startsWith('data:'))
        ? convertFileSrc(photoboothBackground.replace('asset://', ''))
        : photoboothBackground?.startsWith('http') || photoboothBackground?.startsWith('data:')
          ? photoboothBackground
          : null;

      // Prepare all image loading tasks in parallel
      const loadingTasks: Array<Promise<{ type: string; data: any }>> = [];

      // 1. Background image loading task
      if (photoboothBackground && !isSolidColor && bgSrc) {
        loadingTasks.push(
          loadImageWithFallback(bgSrc)
            .then(img => ({ type: 'background', data: img }))
            .catch(() => ({ type: 'background', data: null }))
        );
      }

      // 2. Overlay layers loading tasks (tagged by position for correct render order)
      const belowOverlays = photoboothOverlays
        .filter(o => o.position === 'below-frames' && o.visible)
        .sort((a, b) => a.layerOrder - b.layerOrder);
      const aboveOverlays = photoboothOverlays
        .filter(o => o.position === 'above-frames' && o.visible)
        .sort((a, b) => a.layerOrder - b.layerOrder);

      for (const layer of belowOverlays) {
        loadingTasks.push(
          loadImageWithFallback(convertFileSrc(layer.sourcePath.replace('asset://', '')))
            .then(img => ({ type: 'below-overlay', data: { layer, img } }))
            .catch(() => ({ type: 'below-overlay', data: { layer, img: null } }))
        );
      }
      for (const layer of aboveOverlays) {
        loadingTasks.push(
          loadImageWithFallback(convertFileSrc(layer.sourcePath.replace('asset://', '')))
            .then(img => ({ type: 'above-overlay', data: { layer, img } }))
            .catch(() => ({ type: 'above-overlay', data: { layer, img: null } }))
        );
      }

      // 3. Zone images loading tasks
      for (const zone of frame.zones) {
        const placed = placedImages.get(zone.id);
        if (placed) {
          loadingTasks.push(
            loadImageWithFallback(convertFileSrc(placed.sourceFile.replace('asset://', '')))
              .then(img => ({ type: 'zone', data: { zone, placed, img } }))
              .catch(() => ({ type: 'zone', data: { zone, placed, img: null } }))
          );
        }
      }

      // Load all images in parallel
      const loadedResults = await Promise.all(loadingTasks);

      // Create canvas at upscaled resolution for better print quality.
      // Scale up small images (short side < 1800px) by 2-3x, capped so we don't
      // bloat already-large images.
      // Scale canvas to ~15MP for consistent high-quality print output.
      // scale = sqrt(target / current) preserves aspect ratio exactly.
      // Capped at 5x to avoid extreme upscaling of very small frames.
      const TARGET_PIXELS = 15_000_000;
      const currentPixels = canvasWidth * canvasHeight;
      const printScale = currentPixels >= TARGET_PIXELS ? 1 : Math.min(Math.sqrt(TARGET_PIXELS / currentPixels), 5);
      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth * printScale;
      canvas.height = canvasHeight * printScale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        logger.error('Failed to get canvas context');
        return null;
      }
      if (printScale > 1) ctx.scale(printScale, printScale);

      // Process and draw background
      const bgResult = loadedResults.find(r => r.type === 'background');
      if (photoboothBackground) {
        if (isSolidColor) {
          ctx.fillStyle = photoboothBackground;
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        } else if (bgSrc && bgResult?.data) {
          const bgImg = bgResult.data;
          ctx.save();
          ctx.translate(canvasWidth / 2, canvasHeight / 2);
          ctx.scale(photoboothBackgroundTransform.scale, photoboothBackgroundTransform.scale);
          ctx.translate(photoboothBackgroundTransform.offsetX, photoboothBackgroundTransform.offsetY);
          const bgAspect = bgImg.naturalWidth / bgImg.naturalHeight;
          const canvasAspect = canvasWidth / canvasHeight;
          let drawW: number, drawH: number;
          if (bgAspect > canvasAspect) {
            drawH = canvasHeight;
            drawW = canvasHeight * bgAspect;
          } else {
            drawW = canvasWidth;
            drawH = canvasWidth / bgAspect;
          }
          ctx.drawImage(bgImg, -drawW / 2, -drawH / 2, drawW, drawH);
          ctx.restore();
        } else {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        }
      } else {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      }

      // Draw below-frames overlay layers (before zone images)
      const belowOverlayResults = loadedResults.filter(r => r.type === 'below-overlay');
      for (const result of belowOverlayResults) {
        const { layer, img } = result.data;
        if (!img) continue;
        const t = layer.transform;
        const lx = t.x ?? 0;
        const ly = t.y ?? 0;
        const lScale = t.scale ?? 1;
        const lRotation = t.rotation ?? 0;
        const w = img.naturalWidth;
        const h = img.naturalHeight;

        ctx.save();
        ctx.globalAlpha = t.opacity ?? 1;
        ctx.translate(lx + w / 2, ly + h / 2);
        ctx.rotate((lRotation * Math.PI) / 180);
        ctx.scale(
          lScale * (t.flipHorizontal ? -1 : 1),
          lScale * (t.flipVertical ? -1 : 1)
        );
        ctx.drawImage(img, -w / 2, -h / 2);
        ctx.restore();
      }

      // Process and draw zone images (below overlays first, then zones, then above overlays)
      const zoneResults = loadedResults.filter(r => r.type === 'zone');
      for (const result of zoneResults) {
        const { zone, placed, img } = result.data;
        if (!img) continue;

        const t = placed.transform;
        ctx.save();
        ctx.translate(zone.x + zone.width / 2, zone.y + zone.height / 2);
        if (zone.rotation) ctx.rotate((zone.rotation * Math.PI) / 180);
        applyZoneClipPath(ctx, zone);
        ctx.translate(t.offsetX, t.offsetY);
        if (t.rotation) ctx.rotate((t.rotation * Math.PI) / 180);
        ctx.scale(
          t.scale * (t.flipHorizontal ? -1 : 1),
          t.scale * (t.flipVertical ? -1 : 1)
        );
        const imgAspect = img.naturalWidth / img.naturalHeight;
        const zoneAspect = zone.width / zone.height;
        let drawW: number, drawH: number;
        if (imgAspect > zoneAspect) {
          drawW = zone.width;
          drawH = zone.width / imgAspect;
        } else {
          drawH = zone.height;
          drawW = zone.height * imgAspect;
        }
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();
      }

      // Draw above-frames overlay layers (after zone images)
      const aboveOverlayResults = loadedResults.filter(r => r.type === 'above-overlay');
      for (const result of aboveOverlayResults) {
        const { layer, img } = result.data;
        if (!img) continue;
        const t = layer.transform;
        const lx = t.x ?? 0;
        const ly = t.y ?? 0;
        const lScale = t.scale ?? 1;
        const lRotation = t.rotation ?? 0;
        const w = img.naturalWidth;
        const h = img.naturalHeight;

        ctx.save();
        ctx.globalAlpha = t.opacity ?? 1;
        ctx.translate(lx + w / 2, ly + h / 2);
        ctx.rotate((lRotation * Math.PI) / 180);
        ctx.scale(
          lScale * (t.flipHorizontal ? -1 : 1),
          lScale * (t.flipVertical ? -1 : 1)
        );
        ctx.drawImage(img, -w / 2, -h / 2);
        ctx.restore();
      }

      // Convert to PNG bytes using toBlob (much faster than toDataURL + manual conversion)
      const bytes = await new Promise<Uint8Array>((resolve) => {
        canvas.toBlob((blob) => {
          if (blob) {
            blob.arrayBuffer().then(buffer => resolve(new Uint8Array(buffer)));
          } else {
            resolve(new Uint8Array(0));
          }
        }, 'image/png');
      });

      const filename = `photobooth_${Date.now()}.png`;
      return { bytes, filename };
    } catch (error) {
      logger.error('Failed to export photobooth canvas:', error);
      return null;
    }
  }, [photoboothFrame, photoboothCanvasSize, photoboothAutoMatchBackground, photoboothBackgroundDimensions, photoboothBackground, photoboothBackgroundTransform, photoboothOverlays, placedImages, loadImageWithFallback]);

  return (
    <PhotoboothContext.Provider
      value={{
        photoboothCanvasSize,
        setPhotoboothCanvasSize,
        photoboothBackground,
        setPhotoboothBackground,
        photoboothBackgroundTransform,
        setPhotoboothBackgroundTransform,
        photoboothOverlays,
        setPhotoboothOverlays,
        photoboothAutoMatchBackground,
        setPhotoboothAutoMatchBackground,
        photoboothBackgroundDimensions,
        setPhotoboothBackgroundDimensions,
        photoboothFrame,
        setPhotoboothFrame,
        finalizeViewMode,
        setFinalizeViewMode,
        finalizeEditingZoneId,
        setFinalizeEditingZoneId,
        selectedCustomSetId,
        setSelectedCustomSetId,
        placedImages,
        setPlacedImages,
        updatePlacedImage,
        collageIsDirty,
        setCollageIsDirty,
        resetCollageDirtyState,
        isGeneratingCollage,
        setIsGeneratingCollage,
        exportPhotoboothCanvasAsPNG,
        currentCollageFilename,
        setCurrentCollageFilename,
      }}
    >
      {children}
    </PhotoboothContext.Provider>
  );
}

export function usePhotobooth() {
  const context = useContext(PhotoboothContext);
  if (context === undefined) {
    throw new Error('usePhotobooth must be used within a PhotoboothProvider');
  }
  return context;
}

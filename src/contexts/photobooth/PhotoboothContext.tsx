import { createContext, useContext, useState, useCallback, useEffect, ReactNode, useRef } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { Frame, FrameZone } from '../../types/frame';
import { OverlayLayer } from '../../types/overlay';
import { PlacedImage, ImageTransform } from '../../types/collage';
import { DEFAULT_TRANSFORM } from '../../types/collage';
import { applyZoneClipPath } from '../../utils/canvasShapeClip';
import { createLogger } from '../../utils/logger';

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

  // Image cache using ImageBitmap (faster than HTMLImageElement)
  const bitmapCache = useRef<Map<string, ImageBitmap>>(new Map());

  // Helper: Load an image as ImageBitmap (GPU-accelerated)
  const loadImageAsBitmap = useCallback(async (src: string): Promise<ImageBitmap | null> => {
    // Check cache first
    const cached = bitmapCache.current.get(src);
    if (cached) {
      return cached;
    }

    try {
      // For local files, use fetch + createImageBitmap (faster)
      const response = await fetch(src);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      bitmapCache.current.set(src, bitmap);
      return bitmap;
    } catch (e) {
      logger.warn('Failed to load image as bitmap, falling back to Image element:', e);
      // Fallback to Image element
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = async () => {
          try {
            const bitmap = await createImageBitmap(img);
            bitmapCache.current.set(src, bitmap);
            resolve(bitmap);
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = src;
      });
    }
  }, []);

  // Export photobooth canvas as full-resolution PNG (optimized)
  const exportPhotoboothCanvasAsPNG = useCallback(async (): Promise<{ bytes: Uint8Array; filename: string } | null> => {
    const startTime = performance.now();
    try {
      const frame = photoboothFrame;
      if (!frame) {
        logger.error('No photobooth frame available for export');
        return null;
      }

      // Wait for placed images to be loaded
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

      type BitmapItem = { type: string; layer?: OverlayLayer; zone?: FrameZone; placed?: PlacedImage; bitmap?: ImageBitmap | null };
      const bitmapPromises: Array<{ type: string; promise: Promise<ImageBitmap | null> }> = [];

      // Background
      if (photoboothBackground && !isSolidColor && bgSrc) {
        bitmapPromises.push({
          type: 'background',
          promise: loadImageAsBitmap(bgSrc).catch(() => null)
        });
      }

      // Below overlays
      const belowOverlays = photoboothOverlays
        .filter(o => o.position === 'below-frames' && o.visible)
        .sort((a, b) => a.layerOrder - b.layerOrder);
      for (const layer of belowOverlays) {
        bitmapPromises.push({
          type: `below-overlay:${layer.sourcePath}`,
          promise: loadImageAsBitmap(convertFileSrc(layer.sourcePath.replace('asset://', ''))).catch(() => null)
        });
      }

      // Above overlays
      const aboveOverlays = photoboothOverlays
        .filter(o => o.position === 'above-frames' && o.visible)
        .sort((a, b) => a.layerOrder - b.layerOrder);
      for (const layer of aboveOverlays) {
        bitmapPromises.push({
          type: `above-overlay:${layer.sourcePath}`,
          promise: loadImageAsBitmap(convertFileSrc(layer.sourcePath.replace('asset://', ''))).catch(() => null)
        });
      }

      // Zone images
      for (const zone of frame.zones) {
        const placed = placedImages.get(zone.id);
        if (placed) {
          bitmapPromises.push({
            type: `zone:${zone.id}`,
            promise: loadImageAsBitmap(convertFileSrc(placed.sourceFile.replace('asset://', ''))).catch(() => null)
          });
        }
      }

      // Load all bitmaps in parallel
      const loadStart = performance.now();
      const loadedBitmaps = await Promise.all(
        bitmapPromises.map(async (item, _index) => {
          const bitmap = await item.promise;
          const result: BitmapItem = { type: item.type, bitmap };

          // Add metadata back
          if (item.type.startsWith('below-overlay:')) {
            const layer = belowOverlays.find(l => item.type.endsWith(l.sourcePath));
            if (layer) result.layer = layer;
          } else if (item.type.startsWith('above-overlay:')) {
            const layer = aboveOverlays.find(l => item.type.endsWith(l.sourcePath));
            if (layer) result.layer = layer;
          } else if (item.type.startsWith('zone:')) {
            const zoneId = item.type.split(':')[1];
            const zone = frame.zones.find(z => z.id === zoneId);
            if (zone) result.zone = zone;
            const placed = placedImages.get(zoneId);
            if (placed) result.placed = placed;
          }

          return result;
        })
      );
      logger.debug(`[export] Loaded ${loadedBitmaps.length} bitmaps in ${(performance.now() - loadStart).toFixed(0)}ms`);

      const TARGET_PIXELS = 15_000_000; // 15MP
      const currentPixels = canvasWidth * canvasHeight;
      const printScale = currentPixels >= TARGET_PIXELS ? 1 : Math.min(Math.sqrt(TARGET_PIXELS / currentPixels), 3); // Max 3x instead of 5x

      logger.debug(`[export] Canvas: ${canvasWidth}x${canvasHeight}, Print scale: ${printScale.toFixed(2)}, Output: ${(canvasWidth * printScale).toFixed(0)}x${(canvasHeight * printScale).toFixed(0)}`);

      let canvas: HTMLCanvasElement | OffscreenCanvas;
      let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

      if ('OffscreenCanvas' in window && printScale > 1.5) {
        // Use OffscreenCanvas for large renders (can be moved to worker later)
        const offscreen = new OffscreenCanvas(canvasWidth * printScale, canvasHeight * printScale);
        canvas = offscreen as any;
        ctx = offscreen.getContext('2d') as OffscreenCanvasRenderingContext2D;
      } else {
        canvas = document.createElement('canvas');
        canvas.width = canvasWidth * printScale;
        canvas.height = canvasHeight * printScale;
        ctx = canvas.getContext('2d', { willReadFrequently: true }); // OPTIMIZATION 4: Hint for faster operations
      }

      if (!ctx) {
        logger.error('Failed to get canvas context');
        return null;
      }

      if (printScale > 1 && 'scale' in ctx) {
        (ctx as CanvasRenderingContext2D).scale(printScale, printScale);
      }

      // Draw background
      const bgBitmap = loadedBitmaps.find(b => b.type === 'background')?.bitmap;
      if (photoboothBackground) {
        if (isSolidColor) {
          ctx.fillStyle = photoboothBackground;
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        } else if (bgBitmap) {
          const bgAspect = bgBitmap.width / bgBitmap.height;
          const canvasAspect = canvasWidth / canvasHeight;
          let drawW: number, drawH: number;
          if (bgAspect > canvasAspect) {
            drawH = canvasHeight;
            drawW = canvasHeight * bgAspect;
          } else {
            drawW = canvasWidth;
            drawH = canvasWidth / bgAspect;
          }
          // Draw centered with transform
          ctx.save();
          ctx.translate(canvasWidth / 2, canvasHeight / 2);
          ctx.scale(photoboothBackgroundTransform.scale, photoboothBackgroundTransform.scale);
          ctx.translate(photoboothBackgroundTransform.offsetX, photoboothBackgroundTransform.offsetY);
          ctx.drawImage(bgBitmap, -drawW / 2, -drawH / 2, drawW, drawH);
          ctx.restore();
        } else {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        }
      } else {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      }

      // OPTIMIZATION 5: Draw zone images using ImageBitmap (much faster than Image element)
      for (const item of loadedBitmaps) {
        if (item.type?.startsWith('zone:') && item.bitmap && item.zone && item.placed) {
          const { zone, placed, bitmap } = item;

          ctx.save();
          ctx.translate(zone.x + zone.width / 2, zone.y + zone.height / 2);
          if (zone.rotation) ctx.rotate((zone.rotation * Math.PI) / 180);

          // Only apply clipPath if we have a 2D context (OffscreenCanvas doesn't support all clipping)
          if ('save' in ctx && 'restore' in ctx && 'beginPath' in ctx && 'clip' in ctx) {
            applyZoneClipPath(ctx as CanvasRenderingContext2D, zone);
          }

          ctx.translate(placed.transform.offsetX, placed.transform.offsetY);
          if (placed.transform.rotation) ctx.rotate((placed.transform.rotation * Math.PI) / 180);
          ctx.scale(
            placed.transform.scale * (placed.transform.flipHorizontal ? -1 : 1),
            placed.transform.scale * (placed.transform.flipVertical ? -1 : 1)
          );

          // Calculate cover dimensions
          const imgAspect = bitmap.width / bitmap.height;
          const zoneAspect = zone.width / zone.height;
          let drawW: number, drawH: number;
          if (imgAspect > zoneAspect) {
            drawW = zone.width;
            drawH = zone.width / imgAspect;
          } else {
            drawH = zone.height;
            drawW = zone.height * imgAspect;
          }

          // Direct bitmap draw (GPU accelerated)
          ctx.drawImage(bitmap, -drawW / 2, -drawH / 2, drawW, drawH);
          ctx.restore();
        }
      }

      // Draw below-frames overlays
      for (const item of loadedBitmaps) {
        if (item.type?.startsWith('below-overlay:') && item.bitmap && item.layer) {
          const { layer, bitmap } = item;
          const t = layer.transform;

          ctx.save();
          ctx.globalAlpha = t.opacity ?? 1;
          ctx.translate((t.x ?? 0) + bitmap.width / 2, (t.y ?? 0) + bitmap.height / 2);
          ctx.rotate(((t.rotation ?? 0) * Math.PI) / 180);
          ctx.scale(
            (t.scale ?? 1) * (t.flipHorizontal ? -1 : 1),
            (t.scale ?? 1) * (t.flipVertical ? -1 : 1)
          );
          ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
          ctx.restore();
        }
      }

      // Draw above-frames overlays
      for (const item of loadedBitmaps) {
        if (item.type?.startsWith('above-overlay:') && item.bitmap && item.layer) {
          const { layer, bitmap } = item;
          const t = layer.transform;

          ctx.save();
          ctx.globalAlpha = t.opacity ?? 1;
          ctx.translate((t.x ?? 0) + bitmap.width / 2, (t.y ?? 0) + bitmap.height / 2);
          ctx.rotate(((t.rotation ?? 0) * Math.PI) / 180);
          ctx.scale(
            (t.scale ?? 1) * (t.flipHorizontal ? -1 : 1),
            (t.scale ?? 1) * (t.flipVertical ? -1 : 1)
          );
          ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
          ctx.restore();
        }
      }

      const drawTime = performance.now() - startTime;
      logger.debug(`[export] Drawing complete in ${drawTime.toFixed(0)}ms, encoding...`);

      // OPTIMIZATION 6: Use ImageBitmap for encoding too
      const encodeStart = performance.now();
      let blob: Blob | null = null;
      if (canvas instanceof OffscreenCanvas) {
        blob = await canvas.convertToBlob({ type: 'image/png' });
      } else {
        blob = await new Promise<Blob | null>((resolve) => {
          (canvas as HTMLCanvasElement).toBlob(resolve, 'image/png');
        });
      }
      logger.debug(`[export] PNG encoding: ${(performance.now() - encodeStart).toFixed(0)}ms`);

      if (!blob) {
        logger.error('Failed to encode canvas to blob');
        return null;
      }

      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      const totalTime = performance.now() - startTime;
      logger.debug(`[export] Total time: ${totalTime.toFixed(0)}ms, output: ${bytes.length} bytes`);

      const filename = `photobooth_${Date.now()}.png`;
      return { bytes, filename };
    } catch (error) {
      logger.error('Failed to export photobooth canvas:', error);
      return null;
    }
  }, [photoboothFrame, photoboothCanvasSize, photoboothAutoMatchBackground, photoboothBackgroundDimensions, photoboothBackground, photoboothBackgroundTransform, photoboothOverlays, placedImages, loadImageAsBitmap]);

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

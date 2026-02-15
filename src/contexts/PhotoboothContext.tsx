import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { Frame, FrameZone } from '../types/frame';
import { OverlayLayer } from '../types/overlay';
import { PlacedImage, ImageTransform } from '../types/collage';
import { DEFAULT_TRANSFORM } from '../types/collage';

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

  // Export function
  exportPhotoboothCanvasAsPNG: () => Promise<{ bytes: Uint8Array; filename: string } | null>;
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
  const [finalizeViewMode, setFinalizeViewMode] = useState<'capture' | 'finalize'>('capture');
  const [finalizeEditingZoneId, setFinalizeEditingZoneId] = useState<string | null>(null);
  const [selectedCustomSetId, setSelectedCustomSetId] = useState<string | null>(null);
  const [placedImages, setPlacedImages] = useState<Map<string, PlacedImage>>(new Map());

  // Helper: Update a placed image
  const updatePlacedImage = useCallback((zoneId: string, updates: Partial<PlacedImage>) => {
    setPlacedImages(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(zoneId);
      if (existing) {
        newMap.set(zoneId, { ...existing, ...updates });
      }
      return newMap;
    });
  }, []);

  // Helper: Load an image element from a source URL
  const loadImage = useCallback((src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }, []);

  // Helper: Load an image with fetch+objectURL fallback for CORS
  const loadImageWithFallback = useCallback(async (src: string): Promise<HTMLImageElement> => {
    try {
      return await loadImage(src);
    } catch {
      const resp = await fetch(src);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const img = await loadImage(url);
      URL.revokeObjectURL(url);
      return img;
    }
  }, [loadImage]);

  // Helper: Draw an overlay layer onto a canvas context
  const drawOverlayLayer = useCallback(async (ctx: CanvasRenderingContext2D, layer: OverlayLayer) => {
    try {
      const overlaySrc = convertFileSrc(layer.sourcePath.replace('asset://', ''));
      const img = await loadImageWithFallback(overlaySrc);
      ctx.save();
      ctx.globalAlpha = layer.transform.opacity ?? 1;
      const lx = layer.transform.x ?? 0;
      const ly = layer.transform.y ?? 0;
      const lScale = layer.transform.scale ?? 1;
      const lRotation = layer.transform.rotation ?? 0;
      ctx.translate(lx + (img.naturalWidth * lScale) / 2, ly + (img.naturalHeight * lScale) / 2);
      ctx.rotate((lRotation * Math.PI) / 180);
      ctx.scale(
        lScale * (layer.transform.flipHorizontal ? -1 : 1),
        lScale * (layer.transform.flipVertical ? -1 : 1)
      );
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      ctx.restore();
    } catch {
      // Skip overlay if it fails to load
    }
  }, [loadImageWithFallback]);

  // Export photobooth canvas as full-resolution PNG
  const exportPhotoboothCanvasAsPNG = useCallback(async (): Promise<{ bytes: Uint8Array; filename: string } | null> => {
    try {
      const frame = photoboothFrame;
      if (!frame) {
        console.error('No photobooth frame available for export');
        return null;
      }

      // Calculate canvas dimensions
      const canvasWidth = photoboothAutoMatchBackground && photoboothBackgroundDimensions
        ? photoboothBackgroundDimensions.width
        : photoboothCanvasSize?.width ?? frame.width;
      const canvasHeight = photoboothAutoMatchBackground && photoboothBackgroundDimensions
        ? photoboothBackgroundDimensions.height
        : photoboothCanvasSize?.height ?? frame.height;

      // Create canvas at full resolution
      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.error('Failed to get canvas context');
        return null;
      }

      // Check if background is a solid color
      const isSolidColor = photoboothBackground ? /^#([0-9A-F]{3}){1,2}$/i.test(photoboothBackground) : false;

      // Convert background path to displayable URL
      const bgSrc = (photoboothBackground && !isSolidColor && !photoboothBackground.startsWith('http') && !photoboothBackground.startsWith('data:'))
        ? convertFileSrc(photoboothBackground.replace('asset://', ''))
        : photoboothBackground?.startsWith('http') || photoboothBackground?.startsWith('data:')
          ? photoboothBackground
          : null;

      // 1. Draw background
      if (photoboothBackground) {
        if (isSolidColor) {
          ctx.fillStyle = photoboothBackground;
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        } else if (bgSrc) {
          try {
            const bgImg = await loadImageWithFallback(bgSrc);
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
          } catch {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
          }
        }
      } else {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      }

      // 2. Draw below-frames overlay layers
      const belowOverlays = photoboothOverlays
        .filter(o => o.position === 'below-frames' && o.visible)
        .sort((a, b) => a.layerOrder - b.layerOrder);
      for (const layer of belowOverlays) {
        await drawOverlayLayer(ctx, layer);
      }

      // 3. Draw zones with placed images
      for (const zone of frame.zones) {
        const placed = placedImages.get(zone.id);
        if (!placed) continue;

        let img: HTMLImageElement;
        try {
          img = await loadImageWithFallback(convertFileSrc(placed.sourceFile.replace('asset://', '')));
        } catch {
          continue;
        }

        const t = placed.transform;
        ctx.save();
        ctx.translate(zone.x + zone.width / 2, zone.y + zone.height / 2);
        if (zone.rotation) ctx.rotate((zone.rotation * Math.PI) / 180);
        ctx.beginPath();
        ctx.rect(-zone.width / 2, -zone.height / 2, zone.width, zone.height);
        ctx.clip();
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

      // 4. Draw above-frames overlay layers
      const aboveOverlays = photoboothOverlays
        .filter(o => o.position === 'above-frames' && o.visible)
        .sort((a, b) => a.layerOrder - b.layerOrder);
      for (const layer of aboveOverlays) {
        await drawOverlayLayer(ctx, layer);
      }

      // Convert to PNG bytes
      const dataUrl = canvas.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1];
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);

      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const filename = `photobooth_${Date.now()}.png`;
      return { bytes, filename };
    } catch (error) {
      console.error('Failed to export photobooth canvas:', error);
      return null;
    }
  }, [photoboothFrame, photoboothCanvasSize, photoboothAutoMatchBackground, photoboothBackgroundDimensions, photoboothBackground, photoboothBackgroundTransform, photoboothOverlays, placedImages, loadImageWithFallback, drawOverlayLayer]);

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
        exportPhotoboothCanvasAsPNG,
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

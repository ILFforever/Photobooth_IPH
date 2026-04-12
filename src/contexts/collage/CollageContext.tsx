import { createContext, useContext, useState, ReactNode, useEffect, useCallback, useRef } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { PlacedImage } from '../../types/collage';
import { Frame, FrameZone } from '../../types/frame';
import { applyZoneClipPath } from '../../utils/canvasShapeClip';
import { Background } from '../../types/background';
import { OverlayLayer, LayerPosition, DEFAULT_OVERLAY_TRANSFORM } from '../../types/overlay';
import { createLogger } from '../../utils/logger';

const logger = createLogger('CollageContext');
// Panel type for FloatingFrameSelector
export type FloatingPanelType = "frame" | "canvas" | "background" | null;

export interface CanvasSize {
  width: number;
  height: number;
  name: string;
  isCustom?: boolean;
  createdAt?: string;
}

export const CANVAS_SIZES: CanvasSize[] = [
  { width: 1200, height: 1800, name: '4x6' },
  { width: 1800, height: 1200, name: '6x4' },
  { width: 1500, height: 1500, name: '5x5' },
  { width: 2400, height: 3600, name: '4x6 HD' },
];

export interface BackgroundTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface CollageContextType {
  currentFrame: Frame | null;
  setCurrentFrame: (frame: Frame | null) => void;
  canvasSize: CanvasSize | null;
  setCanvasSize: (size: CanvasSize | null) => void;
  background: string | null;
  setBackground: (bg: string | null) => void;
  backgroundTransform: BackgroundTransform;
  setBackgroundTransform: (transform: BackgroundTransform) => void;
  backgrounds: Background[];
  setBackgrounds: (bgs: Background[]) => void;
  placedImages: Map<string, PlacedImage>;
  setPlacedImages: (images: Map<string, PlacedImage>) => void;
  selectedZone: string | null;
  setSelectedZone: (zoneId: string | null) => void;
  addPlacedImage: (zoneId: string, image: PlacedImage) => void;
  removePlacedImage: (zoneId: string) => void;
  updatePlacedImage: (zoneId: string, updates: Partial<PlacedImage>) => void;
  isBackgroundSelected: boolean;
  setIsBackgroundSelected: (selected: boolean) => void;
  canvasZoom: number;
  setCanvasZoom: (zoom: number) => void;
  customCanvasSizes: CanvasSize[];
  setCustomCanvasSizes: (sizes: CanvasSize[]) => void;
  activeSidebarTab: 'file' | 'edit' | 'frames' | 'layers' | 'custom-sets' | 'export' | 'background';
  setActiveSidebarTab: (tab: 'file' | 'edit' | 'frames' | 'layers' | 'custom-sets' | 'export' | 'background') => void;
  previousSidebarTab: 'file' | 'edit' | 'frames' | 'layers' | 'custom-sets' | 'export' | 'background' | null;
  goBackSidebarTab: () => void;
  customFrames: Frame[];
  setCustomFrames: (frames: Frame[]) => void;
  reloadFrames: () => Promise<void>;
  autoMatchBackground: boolean;
  setAutoMatchBackground: (enabled: boolean) => void;
  backgroundDimensions: { width: number; height: number } | null;
  setBackgroundDimensions: (dims: { width: number; height: number } | null) => void;
  copiedZone: FrameZone | null;
  setCopiedZone: (zone: FrameZone | null) => void;
  captureCanvasThumbnail: () => Promise<string | null>;
  exportCanvasAsPNG: (targetMp?: number) => Promise<{ bytes: Uint8Array; filename: string } | null>;

  // Custom set tracking
  selectedCustomSetName: string | null;
  setSelectedCustomSetName: (name: string | null) => void;
  selectedCustomSetId: string | null;
  setSelectedCustomSetId: (id: string | null) => void;

  // Overlay layer state
  overlays: OverlayLayer[];
  setOverlays: (overlays: OverlayLayer[]) => void;
  selectedOverlayId: string | null;
  setSelectedOverlayId: (id: string | null) => void;

  // Overlay CRUD operations
  addOverlay: (overlay: Omit<OverlayLayer, 'id' | 'createdAt'>) => string;
  updateOverlay: (id: string, updates: Partial<OverlayLayer>) => void;
  deleteOverlay: (id: string) => void;
  duplicateOverlay: (id: string) => void;

  // Layer management
  moveOverlayLayer: (id: string, newPosition: LayerPosition, newOrder: number) => void;
  reorderOverlays: (overlays: OverlayLayer[]) => void;
  toggleOverlayVisibility: (id: string) => void;
  showAllOverlays: boolean;
  setShowAllOverlays: (show: boolean) => void;

  // Snap state for frame creator
  snapEnabled: boolean;
  setSnapEnabled: (enabled: boolean) => void;

  // File import
  importOverlayFiles: (filePaths: string[], position?: LayerPosition) => Promise<void>;

  // Frame creator state
  isFrameCreatorSaving: boolean;
  setIsFrameCreatorSaving: (saving: boolean) => void;

  // FloatingFrameSelector panel state
  openFloatingPanel: FloatingPanelType;
  setOpenFloatingPanel: (panel: FloatingPanelType) => void;
}

const CollageContext = createContext<CollageContextType | undefined>(undefined);

const DEFAULT_BACKGROUND_TRANSFORM: BackgroundTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

export function CollageProvider({ children }: { children: ReactNode }) {
  const [currentFrame, setCurrentFrame] = useState<Frame | null>(null);
  const [canvasSize, setCanvasSize] = useState<CanvasSize | null>(null);
  const [background, setBackground] = useState<string | null>(null);
  const [backgroundTransform, setBackgroundTransform] = useState<BackgroundTransform>(DEFAULT_BACKGROUND_TRANSFORM);
  const [backgrounds, setBackgrounds] = useState<Background[]>([]);
  const [placedImages, setPlacedImages] = useState<Map<string, PlacedImage>>(new Map());
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [isBackgroundSelected, setIsBackgroundSelected] = useState<boolean>(false);
  const [canvasZoom, setCanvasZoom] = useState<number>(1);
  const [customCanvasSizes, setCustomCanvasSizes] = useState<CanvasSize[]>([]);
  const [activeSidebarTab, setActiveSidebarTabRaw] = useState<'file' | 'edit' | 'frames' | 'layers' | 'custom-sets' | 'export' | 'background'>('background');
  const [previousSidebarTab, setPreviousSidebarTab] = useState<'file' | 'edit' | 'frames' | 'layers' | 'custom-sets' | 'export' | 'background' | null>(null);

  const setActiveSidebarTab = useCallback((tab: 'file' | 'edit' | 'frames' | 'layers' | 'custom-sets' | 'export' | 'background') => {
    setActiveSidebarTabRaw(prev => {
      setPreviousSidebarTab(prev);
      return tab;
    });
  }, []);

  const goBackSidebarTab = useCallback(() => {
    if (previousSidebarTab) {
      setActiveSidebarTabRaw(previousSidebarTab);
      setPreviousSidebarTab(null);
    }
  }, [previousSidebarTab]);
  const [customFrames, setCustomFrames] = useState<Frame[]>([]);
  const [autoMatchBackground, setAutoMatchBackground] = useState(false);
  const [backgroundDimensions, setBackgroundDimensions] = useState<{ width: number; height: number } | null>(null);
  const [copiedZone, setCopiedZone] = useState<FrameZone | null>(null);
  const [selectedCustomSetName, setSelectedCustomSetName] = useState<string | null>(null);
  const [selectedCustomSetId, setSelectedCustomSetId] = useState<string | null>(null);

  // Overlay layer state
  const [overlays, setOverlays] = useState<OverlayLayer[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [showAllOverlays, setShowAllOverlays] = useState(true);

  // Snap state for frame creator
  const [snapEnabled, setSnapEnabled] = useState(true);

  // Frame creator state
  const [isFrameCreatorSaving, setIsFrameCreatorSaving] = useState(false);

  // FloatingFrameSelector panel state
  const [openFloatingPanel, setOpenFloatingPanel] = useState<FloatingPanelType>(null);

  // Bitmap cache for export (GPU-accelerated ImageBitmap)
  const bitmapCache = useRef<Map<string, ImageBitmap>>(new Map());
  useEffect(() => {
    return () => {
      bitmapCache.current.forEach(bitmap => bitmap.close());
      bitmapCache.current.clear();
    };
  }, []);

  // Load backgrounds and settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [loadedBgs, savedBg, savedTransform, customCanvases, loadedFrames] = await Promise.all([
          invoke<Background[]>('load_backgrounds'),
          invoke<string | null>('get_app_setting', { key: 'selected_background' })
            .catch((err) => {
              logger.error('Failed to load selected_background setting:', err);
              return null;
            }),
          invoke<string | null>('get_app_setting', { key: 'background_transform' })
            .catch((err) => {
              logger.error('Failed to load background_transform setting:', err);
              return null;
            }),
          invoke<Array<{ width: number; height: number; name: string; created_at: number }>>('get_custom_canvas_sizes')
            .catch((err) => {
              logger.error('Failed to load custom canvas sizes:', err);
              return [];
            }),
          invoke<Frame[]>('load_frames')
            .catch((err) => {
              logger.error('Failed to load frames:', err);
              return [];
            }),
        ]);

        setBackgrounds(loadedBgs);
        if (savedBg) setBackground(savedBg);
        if (savedTransform) {
          setBackgroundTransform(JSON.parse(savedTransform));
        }

        // Load custom canvas sizes
        setCustomCanvasSizes(customCanvases.map((c: { width: number; height: number; name: string; created_at: number }) => ({
          width: c.width,
          height: c.height,
          name: c.name,
          isCustom: true,
          createdAt: c.created_at.toString(),
        })));

        // Load custom frames (non-default frames)
        setCustomFrames(loadedFrames.filter(f => !f.is_default));
      } catch (error) {
        logger.error('Failed to load settings:', error);
      }
    };

    loadSettings();
  }, []);

  // Save background settings when they change
  useEffect(() => {
    if (background !== null) {
      invoke('save_app_setting', { key: 'selected_background', value: background })
        .catch((err) => logger.error('Failed to save selected_background setting:', err));
    }
  }, [background]);

  useEffect(() => {
    invoke('save_app_setting', { key: 'background_transform', value: JSON.stringify(backgroundTransform) })
      .catch((err) => logger.error('Failed to save background_transform setting:', err));
  }, [backgroundTransform]);

  const addPlacedImage = (zoneId: string, image: PlacedImage) => {
    setPlacedImages(prev => {
      const newMap = new Map(prev);
      newMap.set(zoneId, image);
      return newMap;
    });
  };

  const removePlacedImage = (zoneId: string) => {
    setPlacedImages(prev => {
      const newMap = new Map(prev);
      newMap.delete(zoneId);
      return newMap;
    });
  };

  const updatePlacedImage = (zoneId: string, updates: Partial<PlacedImage>) => {
    setPlacedImages(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(zoneId);
      if (existing) {
        newMap.set(zoneId, { ...existing, ...updates });
      }
      return newMap;
    });
  };

  const reloadFrames = async () => {
    try {
      const loadedFrames = await invoke<Frame[]>('load_frames');
      setCustomFrames(loadedFrames.filter(f => !f.is_default));
    } catch (error) {
      logger.error('Failed to reload frames:', error);
    }
  };

  const captureCanvasThumbnail = useCallback(async (): Promise<string | null> => {
    try {
      const frame = currentFrame;
      if (!frame) { logger.error('No frame for thumbnail'); return null; }

      const canvasWidth = autoMatchBackground && backgroundDimensions ? backgroundDimensions.width : canvasSize?.width ?? frame.width;
      const canvasHeight = autoMatchBackground && backgroundDimensions ? backgroundDimensions.height : canvasSize?.height ?? frame.height;

      // Compute inline to avoid temporal dead zone (these consts are defined later in the component)
      const isSolidColor = background ? /^#([0-9A-F]{3}){1,2}$/i.test(background) : false;
      const bgSrc = (background && !isSolidColor && !background.startsWith('http') && !background.startsWith('data:'))
        ? convertFileSrc(background.replace('asset://', ''))
        : background?.startsWith('http') || background?.startsWith('data:') ? background : null;

      // Render at thumbnail resolution (max 400px wide)
      const thumbScale = Math.min(400 / canvasWidth, 1);
      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth * thumbScale;
      canvas.height = canvasHeight * thumbScale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.scale(thumbScale, thumbScale);

      // 1. Background
      if (background) {
        if (isSolidColor) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        } else if (bgSrc) {
          try {
            const bitmap = await loadImageAsBitmap(bgSrc);
            if (bitmap) {
              const bgAspect = bitmap.width / bitmap.height;
              const canvasAspect = canvasWidth / canvasHeight;
              let drawW: number, drawH: number;
              if (bgAspect > canvasAspect) { drawH = canvasHeight; drawW = canvasHeight * bgAspect; }
              else { drawW = canvasWidth; drawH = canvasWidth / bgAspect; }
              ctx.save();
              ctx.translate(canvasWidth / 2, canvasHeight / 2);
              ctx.scale(backgroundTransform.scale, backgroundTransform.scale);
              ctx.translate(backgroundTransform.offsetX, backgroundTransform.offsetY);
              ctx.drawImage(bitmap, -drawW / 2, -drawH / 2, drawW, drawH);
              ctx.restore();
            } else {
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            }
          } catch {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
          }
        }
      } else {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      }

      // 2. Below-frames overlays
      const belowOverlays = overlays.filter(o => o.position === 'below-frames' && o.visible).sort((a, b) => a.layerOrder - b.layerOrder);
      for (const layer of belowOverlays) {
        try {
          const bitmap = await loadImageAsBitmap(convertFileSrc(layer.sourcePath.replace('asset://', '')));
          if (!bitmap) continue;
          const t = layer.transform;
          ctx.save();
          ctx.globalAlpha = t.opacity ?? 1;
          ctx.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;
          ctx.translate((t.x ?? 0) + bitmap.width / 2, (t.y ?? 0) + bitmap.height / 2);
          ctx.rotate(((t.rotation ?? 0) * Math.PI) / 180);
          ctx.scale((t.scale ?? 1) * (t.flipHorizontal ? -1 : 1), (t.scale ?? 1) * (t.flipVertical ? -1 : 1));
          ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
          ctx.restore();
        } catch { /* skip */ }
      }

      // 3. Zone placeholders — no images, just a subtle fill showing the layout
      for (const zone of frame.zones) {
        ctx.save();
        ctx.translate(zone.x + zone.width / 2, zone.y + zone.height / 2);
        if (zone.rotation) ctx.rotate((zone.rotation * Math.PI) / 180);
        applyZoneClipPath(ctx, zone);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.fillRect(-zone.width / 2, -zone.height / 2, zone.width, zone.height);
        ctx.restore();
      }

      // 4. Above-frames overlays
      const aboveOverlays = overlays.filter(o => o.position === 'above-frames' && o.visible).sort((a, b) => a.layerOrder - b.layerOrder);
      for (const layer of aboveOverlays) {
        try {
          const bitmap = await loadImageAsBitmap(convertFileSrc(layer.sourcePath.replace('asset://', '')));
          if (!bitmap) continue;
          const t = layer.transform;
          ctx.save();
          ctx.globalAlpha = t.opacity ?? 1;
          ctx.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;
          ctx.translate((t.x ?? 0) + bitmap.width / 2, (t.y ?? 0) + bitmap.height / 2);
          ctx.rotate(((t.rotation ?? 0) * Math.PI) / 180);
          ctx.scale((t.scale ?? 1) * (t.flipHorizontal ? -1 : 1), (t.scale ?? 1) * (t.flipVertical ? -1 : 1));
          ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
          ctx.restore();
        } catch { /* skip */ }
      }

      return canvas.toDataURL('image/jpeg', 0.85);
    } catch (error) {
      logger.error('Failed to capture canvas thumbnail:', error);
      return null;
    }
  // loadImageAsBitmap is stable ([] deps) so safe to omit; isSolidColor/bgSrc are computed inline
  }, [currentFrame, canvasSize, autoMatchBackground, backgroundDimensions, background, backgroundTransform, overlays]);

  // Helper: Load an image as ImageBitmap (GPU-accelerated, parallel-friendly)
  const loadImageAsBitmap = useCallback(async (src: string): Promise<ImageBitmap | null> => {
    const cached = bitmapCache.current.get(src);
    if (cached) return cached;
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      bitmapCache.current.set(src, bitmap);
      return bitmap;
    } catch {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = async () => {
          try {
            const bitmap = await createImageBitmap(img);
            bitmapCache.current.set(src, bitmap);
            resolve(bitmap);
          } catch { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = src;
      });
    }
  }, []);

  // Helper: Check if background is a solid color
  const isSolidColor = background ? /^#([0-9A-F]{3}){1,2}$/i.test(background) : false;

  // Helper: Convert background path to displayable URL
  const bgSrc = (background && !isSolidColor && !background.startsWith('http') && !background.startsWith('data:'))
    ? convertFileSrc(background.replace('asset://', ''))
    : background?.startsWith('http') || background?.startsWith('data:')
      ? background
      : null;

  // Export canvas as full-resolution PNG
  const exportCanvasAsPNG = useCallback(async (targetMp: number = 15): Promise<{ bytes: Uint8Array; filename: string } | null> => {
    const startTime = performance.now();
    try {
      const frame = currentFrame;
      if (!frame) { logger.error('No frame available for export'); return null; }

      const canvasWidth = autoMatchBackground && backgroundDimensions ? backgroundDimensions.width : canvasSize?.width ?? frame.width;
      const canvasHeight = autoMatchBackground && backgroundDimensions ? backgroundDimensions.height : canvasSize?.height ?? frame.height;

      type BitmapItem = { type: string; layer?: OverlayLayer; zone?: FrameZone; placed?: PlacedImage; bitmap?: ImageBitmap | null };
      const bitmapPromises: Array<{ type: string; promise: Promise<ImageBitmap | null> }> = [];

      // Background
      if (background && !isSolidColor && bgSrc) {
        bitmapPromises.push({ type: 'background', promise: loadImageAsBitmap(bgSrc).catch(() => null) });
      }

      // Overlays
      const belowOverlays = overlays.filter(o => o.position === 'below-frames' && o.visible).sort((a, b) => a.layerOrder - b.layerOrder);
      const aboveOverlays = overlays.filter(o => o.position === 'above-frames' && o.visible).sort((a, b) => a.layerOrder - b.layerOrder);
      for (const layer of belowOverlays) {
        bitmapPromises.push({ type: `below-overlay:${layer.id}`, promise: loadImageAsBitmap(convertFileSrc(layer.sourcePath.replace('asset://', ''))).catch(() => null) });
      }
      for (const layer of aboveOverlays) {
        bitmapPromises.push({ type: `above-overlay:${layer.id}`, promise: loadImageAsBitmap(convertFileSrc(layer.sourcePath.replace('asset://', ''))).catch(() => null) });
      }

      // Zone images
      for (const zone of frame.zones) {
        const placed = placedImages.get(zone.id);
        if (placed) {
          bitmapPromises.push({ type: `zone:${zone.id}`, promise: loadImageAsBitmap(convertFileSrc(placed.sourceFile.replace('asset://', ''))).catch(() => null) });
        }
      }

      // Load all in parallel
      const loadedBitmaps: BitmapItem[] = await Promise.all(
        bitmapPromises.map(async (item) => {
          const bitmap = await item.promise;
          const result: BitmapItem = { type: item.type, bitmap };
          if (item.type.startsWith('below-overlay:')) {
            result.layer = belowOverlays.find(l => item.type.endsWith(l.id));
          } else if (item.type.startsWith('above-overlay:')) {
            result.layer = aboveOverlays.find(l => item.type.endsWith(l.id));
          } else if (item.type.startsWith('zone:')) {
            const zoneId = item.type.split(':')[1];
            result.zone = frame.zones.find(z => z.id === zoneId);
            result.placed = placedImages.get(zoneId);
          }
          return result;
        })
      );
      logger.debug(`[export] Loaded ${loadedBitmaps.length} bitmaps in ${(performance.now() - startTime).toFixed(0)}ms`);

      const currentPixels = canvasWidth * canvasHeight;
      const TARGET_PIXELS = targetMp * 1_000_000;
      const printScale = currentPixels >= TARGET_PIXELS ? 1 : Math.min(Math.sqrt(TARGET_PIXELS / currentPixels), 5);

      let canvas: HTMLCanvasElement | OffscreenCanvas;
      let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if ('OffscreenCanvas' in window && printScale > 1.5) {
        const offscreen = new OffscreenCanvas(canvasWidth * printScale, canvasHeight * printScale);
        canvas = offscreen;
        ctx = offscreen.getContext('2d') as OffscreenCanvasRenderingContext2D;
      } else {
        canvas = document.createElement('canvas');
        canvas.width = canvasWidth * printScale;
        canvas.height = canvasHeight * printScale;
        ctx = (canvas as HTMLCanvasElement).getContext('2d', { willReadFrequently: true });
      }
      if (!ctx) { logger.error('Failed to get canvas context'); return null; }
      if (printScale > 1 && 'scale' in ctx) (ctx as CanvasRenderingContext2D).scale(printScale, printScale);

      // 1. Background
      if (background) {
        if (isSolidColor) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        } else {
          const bgBitmap = loadedBitmaps.find(b => b.type === 'background')?.bitmap;
          if (bgBitmap) {
            const bgAspect = bgBitmap.width / bgBitmap.height;
            const canvasAspect = canvasWidth / canvasHeight;
            let drawW: number, drawH: number;
            if (bgAspect > canvasAspect) { drawH = canvasHeight; drawW = canvasHeight * bgAspect; }
            else { drawW = canvasWidth; drawH = canvasWidth / bgAspect; }
            ctx.save();
            ctx.translate(canvasWidth / 2, canvasHeight / 2);
            ctx.scale(backgroundTransform.scale, backgroundTransform.scale);
            ctx.translate(backgroundTransform.offsetX, backgroundTransform.offsetY);
            ctx.drawImage(bgBitmap, -drawW / 2, -drawH / 2, drawW, drawH);
            ctx.restore();
          } else {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
          }
        }
      } else {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      }

      // Helper: draw a single overlay bitmap with correct transform
      const drawOverlayBitmap = (bitmap: ImageBitmap, layer: OverlayLayer) => {
        const t = layer.transform;
        ctx!.save();
        ctx!.globalAlpha = t.opacity ?? 1;
        ctx!.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;
        ctx!.translate((t.x ?? 0) + bitmap.width / 2, (t.y ?? 0) + bitmap.height / 2);
        ctx!.rotate(((t.rotation ?? 0) * Math.PI) / 180);
        ctx!.scale((t.scale ?? 1) * (t.flipHorizontal ? -1 : 1), (t.scale ?? 1) * (t.flipVertical ? -1 : 1));
        ctx!.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
        ctx!.restore();
      };

      // 2. Below-frames overlays (in order)
      for (const layer of belowOverlays) {
        const item = loadedBitmaps.find(b => b.type === `below-overlay:${layer.id}`);
        if (item?.bitmap && item.layer) drawOverlayBitmap(item.bitmap, item.layer);
      }

      // 3. Zone images
      for (const item of loadedBitmaps) {
        if (!item.type.startsWith('zone:') || !item.bitmap || !item.zone || !item.placed) continue;
        const { zone, placed, bitmap } = item;
        const t = placed.transform;
        ctx.save();
        ctx.translate(zone.x + zone.width / 2, zone.y + zone.height / 2);
        if (zone.rotation) ctx.rotate((zone.rotation * Math.PI) / 180);
        applyZoneClipPath(ctx as CanvasRenderingContext2D, zone);
        ctx.translate(t.offsetX, t.offsetY);
        if (t.rotation) ctx.rotate((t.rotation * Math.PI) / 180);
        ctx.scale(t.scale * (t.flipHorizontal ? -1 : 1), t.scale * (t.flipVertical ? -1 : 1));
        const imgAspect = bitmap.width / bitmap.height;
        const zoneAspect = zone.width / zone.height;
        let drawW: number, drawH: number;
        if (imgAspect > zoneAspect) { drawW = zone.width; drawH = zone.width / imgAspect; }
        else { drawH = zone.height; drawW = zone.height * imgAspect; }
        ctx.drawImage(bitmap, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();
      }

      // 4. Above-frames overlays (in order)
      for (const layer of aboveOverlays) {
        const item = loadedBitmaps.find(b => b.type === `above-overlay:${layer.id}`);
        if (item?.bitmap && item.layer) drawOverlayBitmap(item.bitmap, item.layer);
      }

      // Encode
      let blob: Blob | null = null;
      if (canvas instanceof OffscreenCanvas) {
        blob = await canvas.convertToBlob({ type: 'image/png' });
      } else {
        blob = await new Promise<Blob | null>((resolve) => (canvas as HTMLCanvasElement).toBlob(resolve, 'image/png'));
      }
      if (!blob) { logger.error('Failed to encode canvas as PNG'); return null; }
      const bytes = new Uint8Array(await blob.arrayBuffer());

      logger.debug(`[export] Total: ${(performance.now() - startTime).toFixed(0)}ms, ${bytes.length} bytes`);
      return { bytes, filename: `collage_${Date.now()}.png` };
    } catch (error) {
      logger.error('Failed to export canvas:', error);
      return null;
    }
  }, [currentFrame, canvasSize, autoMatchBackground, backgroundDimensions, background, isSolidColor, bgSrc, backgroundTransform, overlays, placedImages, loadImageAsBitmap]);

  // Overlay CRUD operations
  const addOverlay = useCallback((overlay: Omit<OverlayLayer, 'id' | 'createdAt'>): string => {
    const id = `overlay-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    const newOverlay: OverlayLayer = {
      ...overlay,
      id,
      createdAt: new Date().toISOString(),
    };
    setOverlays(prev => [...prev, newOverlay]);
    return id;
  }, []);

  const updateOverlay = useCallback((id: string, updates: Partial<OverlayLayer>) => {
    setOverlays(prev => prev.map(o =>
      o.id === id ? { ...o, ...updates } : o
    ));
  }, []);

  const deleteOverlay = useCallback((id: string) => {
    setOverlays(prev => prev.filter(o => o.id !== id));
    if (selectedOverlayId === id) {
      setSelectedOverlayId(null);
    }
  }, [selectedOverlayId]);

  const duplicateOverlay = useCallback((id: string) => {
    setOverlays(prev => {
      const original = prev.find(o => o.id === id);
      if (!original) return prev;

      const newId = `overlay-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      const duplicate: OverlayLayer = {
        ...original,
        id: newId,
        name: `${original.name} (copy)`,
        layerOrder: original.layerOrder + 1,
        transform: { ...original.transform },
        createdAt: new Date().toISOString(),
      };

      // Reorder layers after this one
      const updated = prev.map(o => {
        if (o.position === original.position && o.layerOrder > original.layerOrder) {
          return { ...o, layerOrder: o.layerOrder + 1 };
        }
        return o;
      });

      return [...updated, duplicate].sort((a, b) => {
        if (a.position !== b.position) {
          return a.position === 'below-frames' ? -1 : 1;
        }
        return a.layerOrder - b.layerOrder;
      });
    });
  }, []);

  const moveOverlayLayer = useCallback((id: string, newPosition: LayerPosition, newOrder: number) => {
    setOverlays(prev => {
      const layer = prev.find(o => o.id === id);
      if (!layer) return prev;

      // Remove from current position
      const filtered = prev.filter(o => o.id !== id);

      // Get layers in target position
      const targetPositionLayers = filtered
        .filter(o => o.position === newPosition)
        .sort((a, b) => a.layerOrder - b.layerOrder);

      // Adjust orders
      const updated = targetPositionLayers.map((o, idx) => ({
        ...o,
        layerOrder: idx >= newOrder ? idx + 1 : idx
      }));

      // Insert moved layer
      updated.push({
        ...layer,
        position: newPosition,
        layerOrder: newOrder
      });

      // Reconstruct full array
      const otherLayers = filtered.filter(o => o.position !== newPosition);
      return [...otherLayers, ...updated].sort((a, b) => {
        if (a.position !== b.position) {
          return a.position === 'below-frames' ? -1 : 1;
        }
        return a.layerOrder - b.layerOrder;
      });
    });
  }, []);

  const reorderOverlays = useCallback((newOverlays: OverlayLayer[]) => {
    setOverlays(newOverlays);
  }, []);

  const toggleOverlayVisibility = useCallback((id: string) => {
    setOverlays(prev => prev.map(o =>
      o.id === id ? { ...o, visible: !o.visible } : o
    ));
  }, []);

  const importOverlayFiles = useCallback(async (filePaths: string[], position: LayerPosition = 'above-frames') => {
    const { convertFileSrc } = await import('@tauri-apps/api/core');

    for (const filePath of filePaths) {
      // Extract filename from path
      const fileName = filePath.split(/[/\\]/).pop() || 'overlay';

      // Get next layer order for this position
      const currentOverlaysInPosition = overlays.filter(o => o.position === position);
      const maxOrder = currentOverlaysInPosition.length > 0
        ? Math.max(...currentOverlaysInPosition.map(o => o.layerOrder))
        : -1;

      addOverlay({
        name: fileName.replace(/\.(png|PNG)$/, ''),
        sourcePath: convertFileSrc(filePath),
        position,
        layerOrder: maxOrder + 1,
        transform: { ...DEFAULT_OVERLAY_TRANSFORM },
        blendMode: 'normal',
        visible: true,
      });
    }
  }, [overlays, addOverlay]);

  return (
    <CollageContext.Provider
      value={{
        currentFrame,
        setCurrentFrame,
        canvasSize,
        setCanvasSize,
        background,
        setBackground,
        backgroundTransform,
        setBackgroundTransform,
        backgrounds,
        setBackgrounds,
        placedImages,
        setPlacedImages,
        selectedZone,
        setSelectedZone,
        addPlacedImage,
        removePlacedImage,
        updatePlacedImage,
        isBackgroundSelected,
        setIsBackgroundSelected,
        canvasZoom,
        setCanvasZoom,
        customCanvasSizes,
        setCustomCanvasSizes,
        activeSidebarTab,
        setActiveSidebarTab,
        previousSidebarTab,
        goBackSidebarTab,
        customFrames,
        setCustomFrames,
        reloadFrames,
        autoMatchBackground,
        setAutoMatchBackground,
        backgroundDimensions,
        setBackgroundDimensions,
        copiedZone,
        setCopiedZone,
        captureCanvasThumbnail,
        selectedCustomSetName,
        setSelectedCustomSetName,
        selectedCustomSetId,
        setSelectedCustomSetId,
        overlays,
        setOverlays,
        selectedOverlayId,
        setSelectedOverlayId,
        addOverlay,
        updateOverlay,
        deleteOverlay,
        duplicateOverlay,
        moveOverlayLayer,
        reorderOverlays,
        toggleOverlayVisibility,
        showAllOverlays,
        setShowAllOverlays,
        snapEnabled,
        setSnapEnabled,
        importOverlayFiles,
        isFrameCreatorSaving,
        setIsFrameCreatorSaving,
        exportCanvasAsPNG,
        openFloatingPanel,
        setOpenFloatingPanel,
      }}
    >
      {children}
    </CollageContext.Provider>
  );
}

// Export canvas as PNG to bytes (convenience function that uses context)
export async function exportCollageAsPNG(): Promise<{ bytes: Uint8Array; filename: string } | null> {
  // This function needs to be called from within a component that has access to the context
  // For now, we'll return an error to guide developers
  logger.error('exportCollageAsPNG() called directly. Please use the context method: useCollage().exportCanvasAsPNG()');
  return null;
}

export function useCollage() {
  const context = useContext(CollageContext);
  if (context === undefined) {
    throw new Error('useCollage must be used within a CollageProvider');
  }
  return context;
}

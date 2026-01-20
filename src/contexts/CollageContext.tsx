import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { PlacedImage } from '../types/collage';
import { Frame, FrameZone } from '../types/frame';
import { Background } from '../types/background';

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
  activeSidebarTab: 'file' | 'edit' | 'frames' | 'custom-sets';
  setActiveSidebarTab: (tab: 'file' | 'edit' | 'frames' | 'custom-sets') => void;
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
  const [activeSidebarTab, setActiveSidebarTab] = useState<'file' | 'edit' | 'frames' | 'custom-sets'>('file');
  const [customFrames, setCustomFrames] = useState<Frame[]>([]);
  const [autoMatchBackground, setAutoMatchBackground] = useState(false);
  const [backgroundDimensions, setBackgroundDimensions] = useState<{ width: number; height: number } | null>(null);
  const [copiedZone, setCopiedZone] = useState<FrameZone | null>(null);

  // Load backgrounds and settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [loadedBgs, savedBg, savedTransform, customCanvases, loadedFrames] = await Promise.all([
          invoke<Background[]>('load_backgrounds'),
          invoke<string | null>('get_app_setting', { key: 'selected_background' }).catch(() => null),
          invoke<string>('get_app_setting', { key: 'background_transform' }).catch(() => null),
          invoke<Array<{ width: number; height: number; name: string; created_at: number }>>('get_custom_canvas_sizes').catch(() => []),
          invoke<Frame[]>('load_frames').catch(() => []),
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
        console.error('Failed to load settings:', error);
      }
    };

    loadSettings();
  }, []);

  // Save background settings when they change
  useEffect(() => {
    if (background !== null) {
      invoke('save_app_setting', { key: 'selected_background', value: background }).catch(console.error);
    }
  }, [background]);

  useEffect(() => {
    invoke('save_app_setting', { key: 'background_transform', value: JSON.stringify(backgroundTransform) }).catch(console.error);
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
      console.error('Failed to reload frames:', error);
    }
  };

  const captureCanvasThumbnail = async (): Promise<string | null> => {
    try {
      const canvasElement = document.querySelector('.collage-canvas') as HTMLElement;
      if (!canvasElement) {
        console.error('Canvas element not found');
        return null;
      }

      // Import html2canvas dynamically
      const html2canvas = (await import('html2canvas')).default;

      // Capture the canvas at a smaller scale for thumbnail
      const canvas = await html2canvas(canvasElement, {
        scale: 0.3, // Reduce size for thumbnail
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
        logging: false,
      });

      // Convert to base64 data URL
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      return dataUrl;
    } catch (error) {
      console.error('Failed to capture canvas thumbnail:', error);
      return null;
    }
  };

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
      }}
    >
      {children}
    </CollageContext.Provider>
  );
}

export function useCollage() {
  const context = useContext(CollageContext);
  if (context === undefined) {
    throw new Error('useCollage must be used within a CollageProvider');
  }
  return context;
}

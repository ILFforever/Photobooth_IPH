import { createContext, useContext, useState, ReactNode } from 'react';
import { PlacedImage } from '../types/collage';
import { Frame } from '../types/frame';

export interface CanvasSize {
  width: number;
  height: number;
  name: string;
}

export const CANVAS_SIZES: CanvasSize[] = [
  { width: 1200, height: 1800, name: '4x6' },
  { width: 1800, height: 1200, name: '6x4' },
  { width: 1500, height: 1500, name: '5x5' },
  { width: 2400, height: 3600, name: '4x6 HD' },
];

interface CollageContextType {
  currentFrame: Frame | null;
  setCurrentFrame: (frame: Frame | null) => void;
  canvasSize: CanvasSize;
  setCanvasSize: (size: CanvasSize) => void;
  background: string | null;
  setBackground: (bg: string | null) => void;
  placedImages: Map<string, PlacedImage>;
  setPlacedImages: (images: Map<string, PlacedImage>) => void;
  selectedZone: string | null;
  setSelectedZone: (zoneId: string | null) => void;
  addPlacedImage: (zoneId: string, image: PlacedImage) => void;
  removePlacedImage: (zoneId: string) => void;
  updatePlacedImage: (zoneId: string, updates: Partial<PlacedImage>) => void;
}

const CollageContext = createContext<CollageContextType | undefined>(undefined);

export function CollageProvider({ children }: { children: ReactNode }) {
  const [currentFrame, setCurrentFrame] = useState<Frame | null>(null);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>(CANVAS_SIZES[0]);
  const [background, setBackground] = useState<string | null>(null);
  const [placedImages, setPlacedImages] = useState<Map<string, PlacedImage>>(new Map());
  const [selectedZone, setSelectedZone] = useState<string | null>(null);

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

  return (
    <CollageContext.Provider
      value={{
        currentFrame,
        setCurrentFrame,
        canvasSize,
        setCanvasSize,
        background,
        setBackground,
        placedImages,
        setPlacedImages,
        selectedZone,
        setSelectedZone,
        addPlacedImage,
        removePlacedImage,
        updatePlacedImage,
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

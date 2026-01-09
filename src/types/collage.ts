export interface ImageTransform {
  scale: number; // 0.5 to 3.0
  rotation: number; // degrees
  offsetX: number; // pan within zone
  offsetY: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
}

export interface PlacedImage {
  sourceFile: string;
  zoneId: string;
  transform: ImageTransform;
}

export interface CollageProject {
  version: string;
  created: string;
  lastModified: string;
  workingFolder: string;
  background: string | null;
  frameId: string | null;
  placedImages: PlacedImage[];
}

export const DEFAULT_TRANSFORM: ImageTransform = {
  scale: 1.0,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  flipHorizontal: false,
  flipVertical: false,
};

export const CANVAS_SIZE = {
  width: 1200,
  height: 1800,
} as const;

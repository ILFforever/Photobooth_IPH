import { Background } from './background';
import { Frame } from './frame';
import { OverlayLayer } from './overlay';

export interface CanvasSize {
  width: number;
  height: number;
  name: string;
  isCustom?: boolean;
  createdAt?: string;
}

export interface BackgroundTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface CustomSet {
  id: string;
  name: string;
  description: string;

  // Canvas configuration
  canvasSize: CanvasSize;
  autoMatchBackground: boolean;

  // Background configuration
  background: Background;
  backgroundTransform: BackgroundTransform;

  // Layout/Frame
  frame: Frame;

  // Overlay layers configuration
  overlays: OverlayLayer[];

  // Metadata
  thumbnail?: string;
  createdAt: string;
  modifiedAt: string;
  isDefault: boolean;
}

export interface CustomSetPreview {
  id: string;
  name: string;
  description: string;
  thumbnail?: string;
  createdAt: string;
}

// Blend modes following CSS mix-blend-mode and Photoshop conventions
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

// Layer position relative to frame zones
export type LayerPosition = 'below-frames' | 'frames' | 'above-frames';

// Transform state for an overlay layer
export interface OverlayTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  opacity: number;
}

// Individual overlay layer
export interface OverlayLayer {
  /** Instance UUID — unique per usage */
  id: string;
  /** SHA-256 hash pointing to a file in the global asset library */
  assetId: string;
  name: string;
  /** Cached thumbnail URL for UI rendering without resolving the full asset */
  thumbnail?: string;

  position: LayerPosition;
  layerOrder: number;

  transform: OverlayTransform;
  blendMode: BlendMode;
  visible: boolean;

  createdAt: string;
}

export const DEFAULT_OVERLAY_TRANSFORM: OverlayTransform = {
  x: 0,
  y: 0,
  scale: 1.0,
  rotation: 0,
  flipHorizontal: false,
  flipVertical: false,
  opacity: 1.0,
};

export function createOverlayLayer(
  name: string,
  assetId: string,
  position: LayerPosition = 'above-frames',
  layerOrder: number = 0
): Omit<OverlayLayer, 'id' | 'createdAt'> {
  return {
    name,
    assetId,
    position,
    layerOrder,
    transform: { ...DEFAULT_OVERLAY_TRANSFORM },
    blendMode: 'normal',
    visible: true,
  };
}

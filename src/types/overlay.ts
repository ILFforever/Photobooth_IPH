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
  x: number;           // Position X in pixels
  y: number;           // Position Y in pixels
  scale: number;       // Scale (0.1 to 5.0)
  rotation: number;    // Rotation in degrees
  flipHorizontal: boolean;
  flipVertical: boolean;
  opacity: number;     // 0 to 1
}

// Individual overlay layer
export interface OverlayLayer {
  id: string;
  name: string;        // User-friendly name
  sourcePath: string;  // File path to PNG
  thumbnail?: string;  // Base64 thumbnail for UI

  // Layer properties
  position: LayerPosition;  // 'below-frames' or 'above-frames'
  layerOrder: number;       // Order within position group (0 = bottom)

  // Transform
  transform: OverlayTransform;

  // Appearance
  blendMode: BlendMode;
  visible: boolean;

  // Metadata
  createdAt: string;
}

// Default transform for new overlays
export const DEFAULT_OVERLAY_TRANSFORM: OverlayTransform = {
  x: 0,
  y: 0,
  scale: 1.0,
  rotation: 0,
  flipHorizontal: false,
  flipVertical: false,
  opacity: 1.0,
};

// Helper to create a new overlay layer
export function createOverlayLayer(
  name: string,
  sourcePath: string,
  position: LayerPosition = 'above-frames',
  layerOrder: number = 0
): Omit<OverlayLayer, 'id' | 'createdAt'> {
  return {
    name,
    sourcePath,
    position,
    layerOrder,
    transform: { ...DEFAULT_OVERLAY_TRANSFORM },
    blendMode: 'normal',
    visible: true,
  };
}

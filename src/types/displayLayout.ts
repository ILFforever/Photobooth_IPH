import { OverlayTransform, DEFAULT_OVERLAY_TRANSFORM, BlendMode } from './overlay';

export type DisplayElementRole = 'collage' | 'qr' | 'logo' | 'text' | 'gif' | 'shape' | 'emoji';

export type ShapeType =
  | 'rectangle'
  | 'circle'
  | 'rounded-rectangle'
  | 'line'
  | 'triangle'
  | 'diamond'
  | 'star'
  | 'hexagon'
  | 'pentagon'
  | 'cross'
  | 'heart';

export interface DisplayElement {
  id: string;
  role: DisplayElementRole;
  sourcePath?: string;
  textContent?: string;
  fontSize?: number;
  fontColor?: string;
  fontWeight?: string;
  fontFamily?: string;
  // Collage-specific — controls placeholder dimensions in canvas space
  collageWidth?: number;
  collageHeight?: number;
  // Shape-specific
  shapeType?: ShapeType;
  shapeFill?: string;
  shapeBorderColor?: string;
  shapeBorderWidth?: number;
  shapeWidth?: number;
  shapeHeight?: number;
  shapeBorderRadius?: number;
  transform: OverlayTransform;
  blendMode: BlendMode;
  opacity: number;
  visible: boolean;
  layerOrder: number;
}

export interface DisplayLayout {
  id: string;
  name: string;
  backgroundColor: string;
  backgroundImage?: string;
  elements: DisplayElement[];
  thumbnail?: string;
  createdAt: string;
  modifiedAt: string;
  isDefault?: boolean;
  canvasWidth?: number;
  canvasHeight?: number;
}

export interface AspectRatioPreset {
  label: string;
  width: number;
  height: number;
}

export const ASPECT_RATIO_PRESETS: AspectRatioPreset[] = [
  { label: '16:9',  width: 1920, height: 1080 },
  { label: '16:10', width: 1920, height: 1200 },
  { label: '21:9',  width: 2560, height: 1080 },
  { label: '4:3',   width: 1920, height: 1440 },
  { label: '3:2',   width: 1920, height: 1280 },
  { label: '1:1',   width: 1080, height: 1080 },
  { label: '9:16',  width: 1080, height: 1920 },
  { label: '32:9',  width: 3840, height: 1080 },
];

export interface DisplayLayoutPreview {
  id: string;
  name: string;
  thumbnail?: string;
  createdAt: string;
  isDefault?: boolean;
}

export function createDisplayElement(
  role: DisplayElementRole,
  overrides: Partial<DisplayElement> = {},
): DisplayElement {
  return {
    id: `elem-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    role,
    transform: { ...DEFAULT_OVERLAY_TRANSFORM },
    blendMode: 'normal',
    opacity: 1,
    visible: true,
    layerOrder: 0,
    ...overrides,
  };
}

export function createDefaultLayout(): DisplayLayout {
  const now = new Date().toISOString();

  // Mirrors the original hardcoded finalize screen:
  // - Collage fills the left ~55% (padding 32px top/bottom/left)
  // - Right panel: QR in white frame, "SCAN FOR PHOTOS", thank-you line
  //
  // Canvas is 1920×1080. Collage placeholder is 480×540, QR placeholder is 300×300.
  //   Collage at scale 1.88 → ~902×1015, positioned x=32 y=32
  //   Right panel center x ≈ 1460 (midpoint of 960–1888)
  //   QR at scale 0.77 → ~231×231, centered in right panel, y=310
  //   Text below QR: y=570 ("SCAN"), y=612 (thank-you)

  return {
    id: '',
    name: 'IPH',
    backgroundColor: '#1a1a1a',
    isDefault: true,
    elements: [
      // Collage — left portion
      createDisplayElement('collage', {
        transform: { ...DEFAULT_OVERLAY_TRANSFORM, x: 376.024, y: 256.865, scale: 1.659 },
        layerOrder: 0,
      }),
      // QR — right panel
      createDisplayElement('qr', {
        transform: { ...DEFAULT_OVERLAY_TRANSFORM, x: 1362.643, y: 357.417, scale: 0.77 },
        layerOrder: 1,
      }),
      // "SCAN FOR PHOTOS"
      createDisplayElement('text', {
        textContent: 'SCAN FOR PHOTOS',
        fontSize: 30,
        fontColor: '#ffffff',
        fontWeight: '700',
        transform: { ...DEFAULT_OVERLAY_TRANSFORM, x: 1375, y: 666.174 },
        layerOrder: 2,
      }),
      // Thank-you line
      createDisplayElement('text', {
        textContent: 'Thank you for using IPH Photobooth!',
        fontSize: 20,
        fontColor: '#737373',
        fontWeight: '400',
        transform: { ...DEFAULT_OVERLAY_TRANSFORM, x: 1341.532, y: 714.745 },
        layerOrder: 3,
      }),
    ],
    createdAt: now,
    modifiedAt: now,
  };
}

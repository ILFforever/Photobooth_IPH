// Frame system types matching Rust backend

export type FrameShape = 'rectangle' | 'circle' | 'rounded_rect' | 'ellipse' | 'rounded_rect_large' | 'pill';

export interface FrameZone {
  id: string;
  // Fixed positioning system - all in pixels
  x: number;         // X position in pixels from left edge
  y: number;         // Y position in pixels from top edge
  width: number;     // Width in pixels (fixed size)
  height: number;    // Height in pixels (fixed size)
  rotation: number;  // Rotation in degrees
  shape: FrameShape; // Shape type for the zone
  // Optional spacing properties for distance calculations
  margin_right?: number;  // Distance to next zone on right (in pixels)
  margin_bottom?: number; // Distance to next zone below (in pixels)
}

export interface Frame {
  id: string;
  name: string;
  description: string;
  width: number;     // Canvas width in pixels (1200)
  height: number;    // Canvas height in pixels (1800)
  zones: FrameZone[];
  thumbnail?: string; // Base64 thumbnail or path
  is_default: boolean;
  created_at: string;
}

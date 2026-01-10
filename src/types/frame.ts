// Frame system types matching Rust backend

export interface FrameZone {
  id: string;
  x: number;         // X position as percentage (0-100)
  y: number;         // Y position as percentage (0-100)
  width: number;     // Width as percentage (0-100)
  height: number;    // Height as percentage (0-100)
  rotation: number;  // Rotation in degrees
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

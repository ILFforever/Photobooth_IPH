export interface FrameZone {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface Frame {
  id: string;
  name: string;
  zones: FrameZone[];
  backgroundLayer?: string; // base64 or path
  overlayLayer?: string; // base64 or path
  thumbnail?: string; // path to thumbnail
}

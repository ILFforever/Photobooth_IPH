// Background system types matching Rust backend

export interface Background {
  id: string;
  name: string;
  description: string;
  background_type: string; // "color", "gradient", "image"
  value: string; // hex color, gradient CSS, or asset path
  thumbnail?: string;
  is_default: boolean;
  created_at: string;
}

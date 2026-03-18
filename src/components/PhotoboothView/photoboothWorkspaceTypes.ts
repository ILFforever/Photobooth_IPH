import { Camera, Grid3x3, Layers } from "lucide-react";

export type DisplayMode = 'single' | 'center' | 'canvas' | 'finalize';

export interface DisplayPreset {
  id: DisplayMode;
  name: string;
  icon: React.ComponentType<{ size?: number }>;
  description: string;
}

export const displayPresets: DisplayPreset[] = [
  { id: 'single', name: 'Single', icon: Layers, description: 'Single photo view' },
  { id: 'center', name: 'Center', icon: Camera, description: 'Centerstage with recent photos' },
  { id: 'canvas', name: 'Canvas', icon: Grid3x3, description: 'Grid showing all photos' },
];

export interface CurrentSetPhoto {
  id: string;
  thumbnailUrl: string;
  fullUrl?: string;
  timestamp: string;
}

// PtbSession type matching Rust struct
export interface PtbSession {
  name: string;
  createdAt: string;
  lastUsedAt: string;
  shotCount: number;
  photos: Array<{
    filename: string;
    originalPath: string;
    cameraPath: string;
    capturedAt: string;
  }>;
  googleDriveMetadata?: {
    folderId?: string | null;
    folderName?: string | null;
    folderLink?: string | null;
    uploadedImages: Array<{
      filename: string;
      driveFileId: string;
      uploadedAt: string;
    }>;
  };
}

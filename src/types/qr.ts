// Types for QR upload functionality

export interface Result {
  folder_name: string;
  link: string;
  qr_data: string;
}

export interface GoogleAccount {
  email: string;
  name: string;
  picture?: string;
}

export interface DriveFolder {
  id: string;
  name: string;
  is_shared_drive: boolean;
}

export interface HistoryItem {
  timestamp: string;
  folder_name: string;
  link: string;
  qr_data: string;
}

export interface UploadProgress {
  step: string;
  current: number;
  total: number;
  message: string;
}

export interface NoPreviewImage {
  filename: string;
  type: string;
  isRaw?: boolean;
  size?: number;
}

export interface ImageMetadata {
  path: string;
  size: number;
  extension: string;
}

export interface ThumbnailResult {
  original_path: string;
  thumbnail_url: string;
}

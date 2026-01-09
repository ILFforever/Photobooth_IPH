export interface WorkingImage {
  path: string;
  filename: string;
  thumbnail: string; // base64 or asset URL
  size: number;
  extension: string;
}

export interface WorkingFolderInfo {
  path: string;
  images: WorkingImage[];
}

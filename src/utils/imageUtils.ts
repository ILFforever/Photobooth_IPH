// Image processing utility functions
import * as fs from '@tauri-apps/plugin-fs';

export interface ResizeResult {
  dataUrl: string;
  originalMB: number;
  resizedMB: number;
}

/**
 * Reads a file from a native OS path, and if either dimension exceeds
 * maxDim, returns a downscaled JPEG data URL plus size info.
 * Returns null if the image is already within the limit.
 *
 * Uses fs.readFile → Blob → blob URL to avoid tainted-canvas issues
 * that arise when loading cross-origin asset:// URLs into a canvas.
 */
export async function resizeLayoutImageIfNeeded(nativePath: string, maxDim: number): Promise<ResizeResult | null> {
  const bytes = await fs.readFile(nativePath);
  const originalMB = bytes.byteLength / 1024 / 1024;
  const ext = nativePath.split('.').pop()?.toLowerCase() ?? 'jpg';
  const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = blobUrl;
    });
    const { naturalWidth: w, naturalHeight: h } = img;
    if (w <= maxDim && h <= maxDim) return null;
    const scale = Math.min(maxDim / w, maxDim / h);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    // base64 payload length → approximate byte size
    const b64 = dataUrl.indexOf(',') + 1;
    const resizedMB = Math.round((dataUrl.length - b64) * 0.75) / 1024 / 1024;
    return { dataUrl, originalMB, resizedMB };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * List of supported RAW file extensions
 */
export const RAW_EXTENSIONS = ['raw', 'raf', 'cr2', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef', 'srw'];

/**
 * Checks if a file extension is a RAW format
 */
export const isRawExtension = (extension: string): boolean => {
  return RAW_EXTENSIONS.includes(extension.toLowerCase());
};

/**
 * Extracts the file extension from a filename
 */
export const getFileExtension = (filename: string): string => {
  return filename.split('.').pop()?.toLowerCase() || '';
};

/**
 * Extracts the filename from a full path
 */
export const getFilenameFromPath = (path: string): string => {
  return path.split(/[\\/]/).pop() || 'image';
};

/**
 * Gets the parent directory from a file path
 */
export const getParentDirectory = (path: string): string => {
  const lastBackslash = path.lastIndexOf('\\');
  const lastSlash = path.lastIndexOf('/');
  const lastSeparator = Math.max(lastBackslash, lastSlash);
  return lastSeparator > 0 ? path.substring(0, lastSeparator) : path;
};

/**
 * Reads a file as a data URL using FileReader
 */
export const readFileAsDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Filters files to only include image files
 */
export const filterImageFiles = (files: File[]): File[] => {
  return files.filter(file =>
    file.type.startsWith('image/') ||
    /\.(jpg|jpeg|png|gif|webp|bmp|raw|raf|cr2|nef|arw|dng|orf|rw2|pef|srw)$/i.test(file.name)
  );
};

/**
 * Separates files into RAW and regular image arrays
 */
export const separateRawFiles = (files: File[]): { rawFiles: File[]; regularFiles: File[] } => {
  const rawFiles: File[] = [];
  const regularFiles: File[] = [];

  for (const file of files) {
    const ext = getFileExtension(file.name);
    if (isRawExtension(ext)) {
      rawFiles.push(file);
    } else {
      regularFiles.push(file);
    }
  }

  return { rawFiles, regularFiles };
};

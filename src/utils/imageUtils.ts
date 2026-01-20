// Image processing utility functions

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

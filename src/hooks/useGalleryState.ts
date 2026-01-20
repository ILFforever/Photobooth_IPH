import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { NoPreviewImage, ThumbnailResult, ImageMetadata } from '../types/qr';
import {
  isRawExtension,
  getFileExtension,
  getFilenameFromPath,
  getParentDirectory,
  readFileAsDataUrl,
  filterImageFiles,
  separateRawFiles
} from '../utils/imageUtils';

interface GalleryState {
  selectedImages: string[];
  loadedImages: Record<string, boolean>;
  processingImages: string[];
  noPreviewImages: NoPreviewImage[];
  imagePaths: string[];
  assetUrlToFilePath: Record<string, string>;
  thumbnailToFilename: Record<string, string>;
  photosPath: string;
  isDragging: boolean;
}

interface UseGalleryStateReturn extends GalleryState {
  setIsDragging: (value: boolean) => void;
  handleImageLoaded: (path: string) => void;
  handleRemoveImage: (imagePath: string) => Promise<void>;
  handleRemoveNoPreviewImage: (filename: string) => Promise<void>;
  handleAddSingleImage: () => Promise<void>;
  handleAddFromFolder: () => Promise<void>;
  handleDrop: (e: React.DragEvent) => Promise<void>;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  clearGallery: () => Promise<void>;
}

export function useGalleryState(): UseGalleryStateReturn {
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({});
  const [processingImages, setProcessingImages] = useState<string[]>([]);
  const [noPreviewImages, setNoPreviewImages] = useState<NoPreviewImage[]>([]);
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  const [assetUrlToFilePath, setAssetUrlToFilePath] = useState<Record<string, string>>({});
  const [thumbnailToFilename, setThumbnailToFilename] = useState<Record<string, string>>({});
  const [photosPath, setPhotosPath] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const handleImageLoaded = useCallback((path: string) => {
    setLoadedImages(prev => ({ ...prev, [path]: true }));
  }, []);

  const handleRemoveImage = useCallback(async (imagePath: string) => {
    const filename = thumbnailToFilename[imagePath];
    if (filename) {
      try {
        await invoke('remove_temp_image', { filename });
        console.log(`Deleted temp image: ${filename}`);
      } catch (e) {
        console.error('Failed to delete temp image:', e);
      }
      setThumbnailToFilename(prev => {
        const next = { ...prev };
        delete next[imagePath];
        return next;
      });
      setImagePaths(prev => prev.filter(path => !path.endsWith(filename)));
    }

    if (assetUrlToFilePath[imagePath]) {
      setAssetUrlToFilePath(prev => {
        const next = { ...prev };
        delete next[imagePath];
        return next;
      });
    }

    setSelectedImages(prev => prev.filter(img => img !== imagePath));
    setLoadedImages(prev => {
      const next = { ...prev };
      delete next[imagePath];
      return next;
    });
  }, [thumbnailToFilename, assetUrlToFilePath]);

  const handleRemoveNoPreviewImage = useCallback(async (filename: string) => {
    try {
      await invoke('remove_temp_image', { filename });
      console.log(`Deleted temp image: ${filename}`);
    } catch (e) {
      console.error('Failed to delete temp image:', e);
    }

    setNoPreviewImages(prev => prev.filter(img => img.filename !== filename));
    setImagePaths(prev => prev.filter(path => !path.endsWith(filename)));
  }, []);

  const handleAddSingleImage = useCallback(async () => {
    try {
      console.log('Requesting single file selection...');
      const selected = await invoke<string>('select_file');
      if (!selected) return;

      console.log('Selected file:', selected);
      const filename = getFilenameFromPath(selected);
      const parentDir = getParentDirectory(selected);
      setPhotosPath(parentDir);

      const fileExt = getFileExtension(filename);

      if (isRawExtension(fileExt)) {
        console.log(`RAW file detected: ${filename}`);
        const fileExtUpper = fileExt.toUpperCase();

        try {
          const fileInfo = await invoke<{ size: number }>('get_file_info', { filePath: selected });
          setNoPreviewImages(prev => [...prev, {
            filename,
            type: fileExtUpper,
            isRaw: true,
            size: fileInfo.size
          }]);
        } catch (e) {
          console.error('Failed to get file info:', e);
          setNoPreviewImages(prev => [...prev, {
            filename,
            type: fileExtUpper,
            isRaw: true
          }]);
        }

        setImagePaths(prev => [...prev, selected]);
        return;
      }

      setProcessingImages(prev => [...prev, filename]);

      try {
        console.log(`Generating thumbnail for: ${selected}`);
        const thumbnailUrl = await invoke<string>('generate_cached_thumbnail', { imagePath: selected });
        console.log(`Thumbnail generated: ${thumbnailUrl}`);

        setAssetUrlToFilePath(prev => ({ ...prev, [thumbnailUrl]: selected }));

        setSelectedImages(prev => {
          if (prev.includes(thumbnailUrl)) {
            console.log('Thumbnail already exists, skipping');
            return prev;
          }
          return [...prev, thumbnailUrl];
        });
      } catch (e) {
        console.error('Error generating thumbnail:', e);
        const fileExtUpper = fileExt.toUpperCase() || 'FILE';
        setNoPreviewImages(prev => [...prev, { filename, type: fileExtUpper, isRaw: false }]);
      } finally {
        setProcessingImages(prev => prev.filter(name => name !== filename));
      }
    } catch (e) {
      console.error('Error selecting file:', e);
    }
  }, []);

  const handleAddFromFolder = useCallback(async () => {
    try {
      console.log('Requesting folder selection...');
      const selected = await invoke<string>('select_folder');
      if (!selected) return;

      // Clear previous state
      try {
        await invoke('clear_temp_images');
        console.log('Cleared previous temp images');
      } catch (e) {
        console.error('Failed to clear temp images:', e);
      }

      setSelectedImages([]);
      setLoadedImages({});
      setImagePaths([]);
      setNoPreviewImages([]);
      setThumbnailToFilename({});
      setAssetUrlToFilePath({});
      setPhotosPath(selected);

      // Fetch images with metadata
      console.log('Fetching images from:', selected);
      const imageFiles = await invoke<ImageMetadata[]>('get_images_with_metadata', { folderPath: selected });
      console.log('Images found:', imageFiles);

      // Separate RAW files
      const rawFiles = imageFiles.filter(img => isRawExtension(img.extension));
      const regularImages = imageFiles.filter(img => !isRawExtension(img.extension));

      // Add RAW files to noPreviewImages
      const rawFilesData = rawFiles.map(img => ({
        filename: getFilenameFromPath(img.path),
        type: img.extension.toUpperCase(),
        isRaw: true,
        size: img.size
      }));
      setNoPreviewImages(rawFilesData);

      // Show loading skeletons
      const filenames = regularImages.map(img => getFilenameFromPath(img.path));
      setProcessingImages(filenames);

      // Generate thumbnails in batch
      const paths = regularImages.map(img => img.path);
      const thumbnailResults = await invoke<ThumbnailResult[]>(
        'generate_cached_thumbnails_batch',
        { imagePaths: paths }
      );

      // Create mappings
      const assetUrlMapping: Record<string, string> = {};
      const thumbnailUrls = thumbnailResults.map(result => {
        assetUrlMapping[result.thumbnail_url] = result.original_path;
        console.log(`Thumbnail generated: ${result.original_path} -> ${result.thumbnail_url}`);
        return result.thumbnail_url;
      });
      setAssetUrlToFilePath(assetUrlMapping);
      setSelectedImages(thumbnailUrls);
      setProcessingImages([]);
    } catch (e) {
      console.error('Error selecting folder or fetching images:', e);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    console.log('Total files dropped:', files.length);

    const imageFiles = filterImageFiles(files);

    if (imageFiles.length === 0) {
      console.log('No image files found in drop');
      return;
    }

    console.log(`Filtered to ${imageFiles.length} image files`);
    setProcessingImages(prev => [...prev, ...imageFiles.map(f => f.name)]);

    const { rawFiles, regularFiles } = separateRawFiles(imageFiles);

    // Process RAW files
    for (const file of rawFiles) {
      try {
        console.log(`RAW file detected: ${file.name}`);
        const fileExt = getFileExtension(file.name);
        const fileExtUpper = fileExt.toUpperCase();
        setNoPreviewImages(prev => [...prev, { filename: file.name, type: fileExtUpper, isRaw: true, size: file.size }]);

        const dataUrl = await readFileAsDataUrl(file);
        const savedPath = await invoke<string>('save_dropped_image', {
          imageData: dataUrl,
          filename: file.name
        });
        console.log(`RAW file saved to: ${savedPath}`);

        setImagePaths(prev => {
          const newPaths = [...prev, savedPath];
          if (newPaths.length > 0) {
            const parentDir = getParentDirectory(newPaths[0]);
            setPhotosPath(parentDir);
          }
          return newPaths;
        });
      } catch (err) {
        console.error(`Failed to process RAW file ${file.name}:`, err);
      } finally {
        setProcessingImages(prev => prev.filter(name => name !== file.name));
      }
    }

    // Process regular files
    if (regularFiles.length > 0) {
      const savedPaths: { path: string; filename: string }[] = [];

      // Save all files first
      for (const file of regularFiles) {
        try {
          console.log(`Saving ${file.name} to temp folder...`);
          const dataUrl = await readFileAsDataUrl(file);
          const savedPath = await invoke<string>('save_dropped_image', {
            imageData: dataUrl,
            filename: file.name
          });
          console.log(`Saved to: ${savedPath}`);

          savedPaths.push({ path: savedPath, filename: file.name });

          setImagePaths(prev => {
            const newPaths = [...prev, savedPath];
            if (newPaths.length > 0) {
              const parentDir = getParentDirectory(newPaths[0]);
              console.log('Setting photos_path to:', parentDir);
              setPhotosPath(parentDir);
            }
            return newPaths;
          });
        } catch (err) {
          console.error(`Failed to save ${file.name}:`, err);
          setProcessingImages(prev => prev.filter(name => name !== file.name));
        }
      }

      // Batch generate thumbnails
      if (savedPaths.length > 0) {
        try {
          console.log(`Generating ${savedPaths.length} cached thumbnails in batch...`);
          const paths = savedPaths.map(sp => sp.path);
          const thumbnailResults = await invoke<ThumbnailResult[]>(
            'generate_cached_thumbnails_batch',
            { imagePaths: paths }
          );

          const assetUrlMapping: Record<string, string> = {};
          const thumbnailMapping: Record<string, string> = {};

          for (const result of thumbnailResults) {
            assetUrlMapping[result.thumbnail_url] = result.original_path;
            const savedFile = savedPaths.find(sp => sp.path === result.original_path);
            if (savedFile) {
              thumbnailMapping[result.thumbnail_url] = savedFile.filename;
            }
            console.log(`Thumbnail generated: ${result.original_path} -> ${result.thumbnail_url}`);
          }

          setAssetUrlToFilePath(prev => ({ ...prev, ...assetUrlMapping }));
          setThumbnailToFilename(prev => ({ ...prev, ...thumbnailMapping }));
          setSelectedImages(prev => [...prev, ...thumbnailResults.map(r => r.thumbnail_url)]);

          console.log(`Batch thumbnail generation complete: ${thumbnailResults.length} thumbnails`);
        } catch (thumbErr) {
          console.error('Failed to generate thumbnails in batch:', thumbErr);
          for (const sp of savedPaths) {
            const fileExtUpper = getFileExtension(sp.filename).toUpperCase() || 'FILE';
            setNoPreviewImages(prev => [...prev, { filename: sp.filename, type: fileExtUpper, isRaw: false }]);
          }
        }
      }

      setProcessingImages(prev => prev.filter(name => !regularFiles.some(f => f.name === name)));
    }

    console.log('All dropped images processed');
  }, []);

  const clearGallery = useCallback(async () => {
    console.log('Starting new session');

    try {
      await invoke('clear_temp_images');
      console.log('Cleared temp images');
    } catch (e) {
      console.error('Failed to clear temp images:', e);
    }

    setSelectedImages([]);
    setLoadedImages({});
    setImagePaths([]);
    setProcessingImages([]);
    setNoPreviewImages([]);
    setThumbnailToFilename({});
    setAssetUrlToFilePath({});
    setPhotosPath('');
  }, []);

  return {
    selectedImages,
    loadedImages,
    processingImages,
    noPreviewImages,
    imagePaths,
    assetUrlToFilePath,
    thumbnailToFilename,
    photosPath,
    isDragging,
    setIsDragging,
    handleImageLoaded,
    handleRemoveImage,
    handleRemoveNoPreviewImage,
    handleAddSingleImage,
    handleAddFromFolder,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    clearGallery,
  };
}

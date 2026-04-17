import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { WorkingImage } from '../../types/assets';

interface WorkingFolderContextType {
  folderPath: string;
  setFolderPath: (path: string) => void;
  images: WorkingImage[];
  setImages: (images: WorkingImage[]) => void;
  selectedImage: string | null;
  setSelectedImage: (path: string | null) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  loadedImagesMap: Map<number, WorkingImage>;
  setLoadedImagesMap: (map: Map<number, WorkingImage> | ((prev: Map<number, WorkingImage>) => Map<number, WorkingImage>)) => void;
  skeletonCount: number;
  setSkeletonCount: (count: number) => void;
  refreshTrigger: number;
  setRefreshTrigger: React.Dispatch<React.SetStateAction<number>>;
  releaseThumbnails: () => void;
}

const WorkingFolderContext = createContext<WorkingFolderContextType | undefined>(undefined);

export function WorkingFolderProvider({ children }: { children: ReactNode }) {
  const [folderPath, setFolderPath] = useState('');
  const [images, setImages] = useState<WorkingImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedImagesMap, setLoadedImagesMap] = useState<Map<number, WorkingImage>>(new Map());
  const [skeletonCount, setSkeletonCount] = useState(0);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const releaseThumbnails = useCallback(() => {
    // We keep the 'images' array so the list isn't lost,
    // but clear the map that holds the actual loaded thumbnail data.
    setLoadedImagesMap(new Map());
  }, []);

  return (
    <WorkingFolderContext.Provider
      value={{
        folderPath,
        setFolderPath,
        images,
        setImages,
        selectedImage,
        setSelectedImage,
        loading,
        setLoading,
        loadedImagesMap,
        setLoadedImagesMap,
        skeletonCount,
        setSkeletonCount,
        refreshTrigger,
        setRefreshTrigger,
        releaseThumbnails,
      }}
    >
      {children}
    </WorkingFolderContext.Provider>
  );
}

export function useWorkingFolder() {
  const context = useContext(WorkingFolderContext);
  if (context === undefined) {
    throw new Error('useWorkingFolder must be used within a WorkingFolderProvider');
  }
  return context;
}

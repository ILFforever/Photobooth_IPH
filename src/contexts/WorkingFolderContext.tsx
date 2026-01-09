import { createContext, useContext, useState, ReactNode } from 'react';
import { WorkingImage } from '../types/assets';

interface WorkingFolderContextType {
  folderPath: string;
  setFolderPath: (path: string) => void;
  images: WorkingImage[];
  setImages: (images: WorkingImage[]) => void;
  selectedImage: string | null;
  setSelectedImage: (path: string | null) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
}

const WorkingFolderContext = createContext<WorkingFolderContextType | undefined>(undefined);

export function WorkingFolderProvider({ children }: { children: ReactNode }) {
  const [folderPath, setFolderPath] = useState('');
  const [images, setImages] = useState<WorkingImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

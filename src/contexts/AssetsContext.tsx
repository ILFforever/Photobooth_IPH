import { createContext, useContext, useState, ReactNode } from 'react';
import { Frame } from '../types/frame';

interface AssetsContextType {
  frames: Frame[];
  setFrames: (frames: Frame[]) => void;
  backgrounds: string[];
  setBackgrounds: (backgrounds: string[]) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
}

const AssetsContext = createContext<AssetsContextType | undefined>(undefined);

export function AssetsProvider({ children }: { children: ReactNode }) {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [backgrounds, setBackgrounds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  return (
    <AssetsContext.Provider
      value={{
        frames,
        setFrames,
        backgrounds,
        setBackgrounds,
        loading,
        setLoading,
      }}
    >
      {children}
    </AssetsContext.Provider>
  );
}

export function useAssets() {
  const context = useContext(AssetsContext);
  if (context === undefined) {
    throw new Error('useAssets must be used within an AssetsProvider');
  }
  return context;
}

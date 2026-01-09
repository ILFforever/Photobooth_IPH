import { createContext, useContext, useState, ReactNode } from 'react';

export interface HistoryItem {
  timestamp: string;
  folder_name: string;
  link: string;
  qr_data: string;
  version?: number;
  type?: 'collage' | 'qr-only';
  metadata?: {
    frameName?: string;
    imageCount?: number;
    includesSources?: boolean;
  };
}

export interface UploadProgress {
  step: string;
  current: number;
  total: number;
  message: string;
}

export interface QRUploadItem {
  collagePath?: string;
  sourceFiles: string[];
  includeSources: boolean;
}

interface QRContextType {
  uploadQueue: QRUploadItem[];
  setUploadQueue: (queue: QRUploadItem[]) => void;
  history: HistoryItem[];
  setHistory: (history: HistoryItem[]) => void;
  showHistoryModal: boolean;
  setShowHistoryModal: (show: boolean) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  uploadProgress: UploadProgress | null;
  setUploadProgress: (progress: UploadProgress | null) => void;
  addToQueue: (item: QRUploadItem) => void;
}

const QRContext = createContext<QRContextType | undefined>(undefined);

export function QRProvider({ children }: { children: ReactNode }) {
  const [uploadQueue, setUploadQueue] = useState<QRUploadItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  const addToQueue = (item: QRUploadItem) => {
    setUploadQueue(prev => [...prev, item]);
  };

  return (
    <QRContext.Provider
      value={{
        uploadQueue,
        setUploadQueue,
        history,
        setHistory,
        showHistoryModal,
        setShowHistoryModal,
        loading,
        setLoading,
        uploadProgress,
        setUploadProgress,
        addToQueue,
      }}
    >
      {children}
    </QRContext.Provider>
  );
}

export function useQR() {
  const context = useContext(QRContext);
  if (context === undefined) {
    throw new Error('useQR must be used within a QRProvider');
  }
  return context;
}

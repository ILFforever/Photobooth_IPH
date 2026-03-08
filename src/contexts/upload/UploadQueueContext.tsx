import { createContext, useContext, useState, useCallback, useEffect, ReactNode, useRef } from "react";
import { invoke } from '@tauri-apps/api/core';
import { useToast } from "../system";
import type { UploadQueueItem, UploadQueueStats, UploadStatus as UploadStatusType } from '../../types/uploadQueue';
import { createLogger } from '../../utils/logger';

const logger = createLogger('UploadQueue');

// Map Rust enum values to TypeScript enum
export enum UploadStatus {
  PENDING = 'pending',
  UPLOADING = 'uploading',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRYING = 'retrying',
  CANCELLED = 'cancelled'
}

interface UploadQueueContextType {
  // Queue state
  queueItems: UploadQueueItem[];
  isProcessing: boolean;
  stats: UploadQueueStats;

  // Operations
  enqueuePhotos: (sessionId: string, photos: Array<{ filename: string; localPath: string }>, driveFolderId: string) => Promise<void>;
  getSessionQueue: (sessionId: string) => Promise<void>;
  retryUpload: (itemId: string) => Promise<void>;
  cancelUpload: (itemId: string) => Promise<void>;
  refreshStats: () => Promise<void>;

  // Auto-refresh control
  startAutoRefresh: (sessionId: string) => void;
  stopAutoRefresh: () => void;
}

const UploadQueueContext = createContext<UploadQueueContextType | undefined>(undefined);

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
  const [queueItems, setQueueItems] = useState<UploadQueueItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stats, setStats] = useState<UploadQueueStats>({
    total: 0,
    pending: 0,
    uploading: 0,
    completed: 0,
    failed: 0,
    retrying: 0
  });

  const autoRefreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentSessionRef = useRef<string | null>(null);

  // Enqueue photos for upload
  const enqueuePhotos = useCallback(async (
    sessionId: string,
    photos: Array<{ filename: string; localPath: string }>,
    driveFolderId: string
  ) => {
    try {
      const items = photos.map((photo, index) => ({
        id: `${sessionId}-${photo.filename}-${Date.now()}-${index}`,
        sessionId,
        filename: photo.filename,
        localPath: photo.localPath,
        driveFolderId,
        status: UploadStatus.PENDING,
        progress: 0,
        retryCount: 0,
        maxRetries: 3,
        timeoutSecs: 300, // 5 minutes in seconds
        createdAt: new Date().toISOString()
      }));

      await invoke('enqueue_upload_items', { items });

      // Refresh queue for this session
      await getSessionQueue(sessionId);

      showToast('Upload Queued', 'success', 3000, `${photos.length} photo(s) added to upload queue`);
    } catch (error) {
      logger.error('Failed to enqueue photos:', error);
      showToast('Upload Failed', 'error', 5000, error instanceof Error ? error.message : 'Failed to queue photos for upload');
    }
  }, [showToast]);

  // Get session queue items
  const getSessionQueue = useCallback(async (sessionId: string) => {
    try {
      const items = await invoke<any[]>('get_session_upload_queue', { sessionId });

      // Convert Rust enum strings to TypeScript enum values
      const convertedItems: UploadQueueItem[] = items.map(item => ({
        ...item,
        status: mapRustStatusToTs(item.status)
      }));

      setQueueItems(convertedItems);
    } catch (error) {
      logger.error('Failed to get session queue:', error);
    }
  }, []);

  // Helper function to map Rust status strings to TypeScript enums
  const mapRustStatusToTs = (rustStatus: string): UploadStatusType => {
    switch (rustStatus.toLowerCase()) {
      case 'pending': return UploadStatus.PENDING;
      case 'uploading': return UploadStatus.UPLOADING;
      case 'completed': return UploadStatus.COMPLETED;
      case 'failed': return UploadStatus.FAILED;
      case 'retrying': return UploadStatus.RETRYING;
      case 'cancelled': return UploadStatus.CANCELLED;
      default: return UploadStatus.PENDING;
    }
  };

  // Refresh statistics
  const refreshStats = useCallback(async () => {
    try {
      const stats = await invoke<any>('get_upload_queue_stats');
      setStats(stats);
    } catch (error) {
      logger.error('Failed to get queue stats:', error);
    }
  }, []);

  // Retry a failed upload
  const retryUpload = useCallback(async (itemId: string) => {
    try {
      await invoke('retry_upload', { itemId });
      await getSessionQueue(currentSessionRef.current || '');
      showToast('Upload Retried', 'info', 3000, 'Upload has been queued for retry');
    } catch (error) {
      logger.error('Failed to retry upload:', error);
      showToast('Retry Failed', 'error', 5000, error instanceof Error ? error.message : 'Failed to retry upload');
    }
  }, [getSessionQueue, showToast]);

  // Cancel an upload
  const cancelUpload = useCallback(async (itemId: string) => {
    try {
      await invoke('cancel_queued_upload', { itemId });
      await getSessionQueue(currentSessionRef.current || '');
      showToast('Upload Cancelled', 'info', 3000, 'Upload has been cancelled');
    } catch (error) {
      logger.error('Failed to cancel upload:', error);
      showToast('Cancel Failed', 'error', 5000, error instanceof Error ? error.message : 'Failed to cancel upload');
    }
  }, [getSessionQueue, showToast]);

  // Start auto-refresh for a session
  const startAutoRefresh = useCallback((sessionId: string) => {
    stopAutoRefresh(); // Stop any existing refresh

    currentSessionRef.current = sessionId;
    getSessionQueue(sessionId);
    refreshStats();

    autoRefreshIntervalRef.current = setInterval(() => {
      if (currentSessionRef.current) {
        getSessionQueue(currentSessionRef.current);
        refreshStats();
      }
    }, 2000); // Refresh every 2 seconds
  }, [getSessionQueue, refreshStats]);

  // Stop auto-refresh
  const stopAutoRefresh = useCallback(() => {
    if (autoRefreshIntervalRef.current) {
      clearInterval(autoRefreshIntervalRef.current);
      autoRefreshIntervalRef.current = null;
    }
    currentSessionRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAutoRefresh();
    };
  }, [stopAutoRefresh]);

  return (
    <UploadQueueContext.Provider
      value={{
        queueItems,
        isProcessing,
        stats,
        enqueuePhotos,
        getSessionQueue,
        retryUpload,
        cancelUpload,
        refreshStats,
        startAutoRefresh,
        stopAutoRefresh
      }}
    >
      {children}
    </UploadQueueContext.Provider>
  );
}

export function useUploadQueue() {
  const context = useContext(UploadQueueContext);
  if (!context) {
    throw new Error('useUploadQueue must be used within UploadQueueProvider');
  }
  return context;
}

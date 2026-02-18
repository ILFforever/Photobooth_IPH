// Upload queue item types

export enum UploadStatus {
  PENDING = 'pending',
  UPLOADING = 'uploading',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRYING = 'retrying',
  CANCELLED = 'cancelled'
}

export interface UploadQueueItem {
  id: string;
  sessionId: string;
  filename: string;
  localPath: string;
  driveFolderId: string;
  status: UploadStatus;
  progress: number;
  error?: string;
  retryCount: number;
  maxRetries: number;
  timeout: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  nextRetryAt?: string;
}

export interface UploadQueueStats {
  total: number;
  pending: number;
  uploading: number;
  completed: number;
  failed: number;
  retrying: number;
}

export interface UploadQueueState {
  items: UploadQueueItem[];
  isProcessing: boolean;
  currentUploadId: string | null;
}

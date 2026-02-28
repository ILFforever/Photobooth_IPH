/**
 * Update-related type definitions
 * Shared between components for update checking functionality
 */

export interface AppVersionStatus {
  current_version: string;
  latest_version: string | null;
  update_available: boolean;
  release_notes: string[];
  file_size: number | null;
  has_download: boolean;
  is_dev_build: boolean;
}

export interface VMVersionStatus {
  current_version: string;
  latest_version: string | null;
  update_available: boolean;
  iso_exists: boolean;
  iso_modified_date: string | null;
  release_notes: string[];
  file_size: number | null;
  has_download: boolean;
}

export interface VersionStatus {
  app: AppVersionStatus;
  vm: VMVersionStatus;
}

export interface LatestVersionInfo {
  id: string;
  type: 'msi' | 'vm';
  version: string;
  has_download: boolean;
  file_hash: string | null;
  file_size: number | null;
  release_notes: string[];
  created_at: string;
}

export interface UpdateDownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
}

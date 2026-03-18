import { ReactNode } from "react";
import { CaptureTimingProvider, useCaptureTiming } from "./PhotoboothCaptureSettingsContext";
import { WorkspaceSettingsProvider, useWorkspaceSettings } from "./PhotoboothWorkspaceSettingsContext";
import { PhotoboothSessionProvider, usePhotoboothSession } from "./PhotoboothSessionContext";

// Re-export types for backward compatibility — many files import these from this path
export type { CaptureTimingContextType } from "./PhotoboothCaptureSettingsContext";
export type { WorkspaceSettingsContextType } from "./PhotoboothWorkspaceSettingsContext";
export type { PhotoboothSessionContextType } from "./PhotoboothSessionContext";

// Re-export providers and hooks from new files
export { CaptureTimingProvider, useCaptureTiming } from "./PhotoboothCaptureSettingsContext";
export { WorkspaceSettingsProvider, useWorkspaceSettings } from "./PhotoboothWorkspaceSettingsContext";
export { PhotoboothSessionProvider, usePhotoboothSession } from "./PhotoboothSessionContext";

// Google Drive uploaded image metadata
export interface DriveUploadedImage {
  filename: string;
  driveFileId: string;
  uploadedAt: string;
}

// Google Drive metadata for a session
export interface GoogleDriveMetadata {
  folderId?: string | null;
  folderName?: string | null;
  folderLink?: string | null;
  accountId?: string | null;  // Email of the account that created the folder
  uploadedImages: DriveUploadedImage[];
}

// Session info structure matching the backend
export interface PhotoboothSessionInfo {
  id: string;
  name: string;
  folderName: string;
  shotCount: number;
  createdAt: string;
  lastUsedAt: string;
  thumbnails: string[]; // Thumbnail URLs for the session's photos
  googleDriveMetadata: GoogleDriveMetadata;
  qrUploadEnabled?: boolean;
  qrUploadAllImages?: boolean;
  photoNamingScheme?: string;
}

// Photo entry in a session
export interface SessionPhoto {
  filename: string;
  originalPath: string;
  cameraPath: string;
  capturedAt: string;
}

// Full session data with photos
export interface PhotoboothSession {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string;
  shotCount: number;
  photos: SessionPhoto[];
  googleDriveMetadata: GoogleDriveMetadata;
  qrUploadEnabled?: boolean;
  qrUploadAllImages?: boolean;
  photoNamingScheme?: string;
}

// Last generated media
export interface LastGeneratedMedia {
  gif?: {
    filePath: string;
    fileName: string;
    fileSize: number;
    photoCount: number;
    generatedAt: string;
  };
  video?: {
    filePath: string;
    fileName: string;
    fileSize: number;
    photoCount: number;
    generatedAt: string;
  };
}

/**
 * Composed provider that wraps the 3 split contexts in the correct order.
 * CaptureTimingProvider is outermost (no dependencies),
 * WorkspaceSettingsProvider reads from CaptureTiming,
 * PhotoboothSessionProvider reads from both.
 */
export function PhotoboothSettingsProvider({ children }: { children: ReactNode }) {
  return (
    <CaptureTimingProvider>
      <WorkspaceSettingsProvider>
        <PhotoboothSessionProvider>
          {children}
        </PhotoboothSessionProvider>
      </WorkspaceSettingsProvider>
    </CaptureTimingProvider>
  );
}

/**
 * Shim hook that merges all 3 split hooks into the original API shape.
 * All existing consumers can continue using usePhotoboothSettings() unchanged.
 */
export function usePhotoboothSettings() {
  const captureTiming = useCaptureTiming();
  const workspaceSettings = useWorkspaceSettings();
  const session = usePhotoboothSession();

  return {
    ...captureTiming,
    ...workspaceSettings,
    ...session,
  };
}

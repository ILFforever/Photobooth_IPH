import { invoke } from "@tauri-apps/api/core";
import type { GoogleDriveMetadata } from "../contexts/PhotoboothSettingsContext";

/**
 * Generate a random folder name for Google Drive session uploads
 * Format: {BaseName}_{8-char-random} (e.g., "JobFair_qaw3r4sd")
 * @param baseName - The base name from the parent folder (e.g., "JobFair")
 */
export function generateRandomFolderName(baseName: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let randomPart = '';
  for (let i = 0; i < 8; i++) {
    randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${baseName}_${randomPart}`;
}

/**
 * Extract base name from working folder path
 * Example: "C:\Photos\JobFair" -> "JobFair"
 */
export function getBaseNameFromPath(folderPath: string): string {
  // Handle both Windows and Unix paths
  const parts = folderPath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || 'Session';
}

/**
 * Update Google Drive metadata for a session
 */
export async function updateSessionDriveMetadata(
  folderPath: string,
  sessionId: string,
  folderId: string | null,
  folderName: string | null,
  folderLink: string | null
): Promise<void> {
  await invoke("update_session_drive_metadata", {
    folderPath,
    sessionId,
    folderId,
    folderName,
    folderLink,
  });
}

/**
 * Add an uploaded image to session's Google Drive metadata
 */
export async function addSessionDriveUpload(
  folderPath: string,
  sessionId: string,
  filename: string,
  driveFileId: string
): Promise<void> {
  await invoke("add_session_drive_upload", {
    folderPath,
    sessionId,
    filename,
    driveFileId,
  });
}

/**
 * Check if an image has been uploaded to Google Drive for a session
 */
export async function isImageUploadedToDrive(
  folderPath: string,
  sessionId: string,
  filename: string
): Promise<boolean> {
  return await invoke<boolean>("is_image_uploaded_to_drive", {
    folderPath,
    sessionId,
    filename,
  });
}

/**
 * Clear all uploaded images from session's Google Drive metadata
 */
export async function clearSessionDriveUploads(
  folderPath: string,
  sessionId: string
): Promise<void> {
  await invoke("clear_session_drive_uploads", {
    folderPath,
    sessionId,
  });
}

/**
 * Initialize Google Drive folder for a session
 * This creates the Drive folder with a random name and updates the session metadata
 * Format: {BaseName}_{8-char-random} (e.g., "JobFair_qaw3r4sd")
 */
export async function initializeSessionDriveFolder(
  folderPath: string,
  sessionId: string,
  parentFolderId: string | null
): Promise<GoogleDriveMetadata> {
  // Extract base name from the working folder path
  const baseName = getBaseNameFromPath(folderPath);
  const randomFolderName = generateRandomFolderName(baseName);

  // Create the folder in Google Drive using existing utilities
  const { createDriveFolder } = await import("./driveFolder");
  const driveFolder = await createDriveFolder(randomFolderName, parentFolderId);

  // Generate shareable link (format: https://drive.google.com/drive/folders/{folderId})
  const folderLink = `https://drive.google.com/drive/folders/${driveFolder.id}`;

  // Update session metadata
  await updateSessionDriveMetadata(
    folderPath,
    sessionId,
    driveFolder.id,
    randomFolderName,
    folderLink
  );

  return {
    folderId: driveFolder.id,
    folderName: randomFolderName,
    folderLink,
    uploadedImages: [],
  };
}

/**
 * Get the Google Drive folder ID for a session, creating one if it doesn't exist
 */
export async function ensureSessionDriveFolder(
  folderPath: string,
  sessionId: string,
  currentMetadata: GoogleDriveMetadata,
  parentFolderId: string | null
): Promise<GoogleDriveMetadata> {
  // If folder already exists, return current metadata
  if (currentMetadata.folderId) {
    return currentMetadata;
  }

  // Otherwise, initialize a new folder
  return await initializeSessionDriveFolder(folderPath, sessionId, parentFolderId);
}

import { useCallback, useState } from "react";
import { usePhotobooth, useUploadQueue, useAuth, usePhotoboothSettings, useToast } from "../contexts";
import * as fs from "@tauri-apps/plugin-fs";
import { createLogger } from "../utils/logger";

const logger = createLogger('useCollageUpload');

export function useCollageUpload() {
  const {
    currentCollageFilename,
    setCurrentCollageFilename,
    collageIsDirty,
    resetCollageDirtyState,
    exportPhotoboothCanvasAsPNG,
    isGeneratingCollage,
    setIsGeneratingCollage,
  } = usePhotobooth();
  const { enqueuePhotos } = useUploadQueue();
  const { account } = useAuth();
  const { qrUploadEnabled } = usePhotoboothSettings();
  const { showToast } = useToast();

  const [isUploading, setIsUploading] = useState(false);

  const uploadCollage = useCallback(
    async (
      currentSession: any,
      workingFolder: string,
      sessions: any[],
      driveMetadata: any
    ) => {
      if (!currentSession || !workingFolder || !driveMetadata?.folderId) {
        logger.debug('[useCollageUpload] Skipping upload - missing session, folder, or Drive folder ID');
        return;
      }

      // Block uploads if QR upload is disabled
      if (!qrUploadEnabled) {
        logger.debug('[useCollageUpload] Skipping upload - QR upload disabled');
        return;
      }

      // Check authentication state
      const { getDriveAuthState, areUploadsEnabled } = await import("../utils/driveAuthState");
      const driveAuthState = getDriveAuthState(driveMetadata, account);
      if (!areUploadsEnabled(driveAuthState.state)) {
        logger.debug('[useCollageUpload] Skipping upload - not authenticated or account mismatch');
        return;
      }

      // Check if another operation is already generating
      if (isGeneratingCollage) {
        logger.debug('[useCollageUpload] Skipping upload - collage is being generated');
        return;
      }

      setIsUploading(true);
      try {
        const sessionFolder =
          sessions.find((s) => s.id === currentSession.id)?.folderName ||
          currentSession.id;
        let filename: string;

        // Use cached version if not dirty
        if (currentCollageFilename && !collageIsDirty) {
          filename = currentCollageFilename;
          logger.debug('[useCollageUpload] Using existing collage:', filename);
        } else {
          // Set generating state to block other operations
          setIsGeneratingCollage(true);

          // Export collage canvas as PNG
          const exportResult = await exportPhotoboothCanvasAsPNG();
          if (!exportResult) {
            logger.warn('[useCollageUpload] Export failed - not ready');
            setIsGeneratingCollage(false);
            return;
          }

          const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
          const randomStr = Array.from(
            { length: 8 },
            () => chars[Math.floor(Math.random() * chars.length)]
          ).join("");
          filename = `Collage_${randomStr}.png`;
          setCurrentCollageFilename(filename);
          resetCollageDirtyState();

          // Save to session folder using FS plugin
          const sessionPath = `${workingFolder}/${sessionFolder}`;
          await fs.mkdir(sessionPath, { recursive: true });
          await fs.writeFile(`${sessionPath}/${filename}`, exportResult.bytes);

          // Clear generating state after save
          setIsGeneratingCollage(false);
        }

        // Enqueue for upload
        const localPath = `${workingFolder}/${sessionFolder}/${filename}`;
        await enqueuePhotos(
          currentSession.id,
          [{ filename, localPath }],
          driveMetadata.folderId
        );

        logger.debug('[useCollageUpload] Collage uploaded successfully');
        showToast('Collage uploaded', 'success', 3000, filename);
      } catch (error) {
        logger.error('[useCollageUpload] Upload failed:', error);
        showToast(
          'Upload failed',
          'error',
          5000,
          error instanceof Error ? error.message : String(error)
        );
      } finally {
        setIsUploading(false);
      }
    },
    [
      account,
      collageIsDirty,
      currentCollageFilename,
      exportPhotoboothCanvasAsPNG,
      isGeneratingCollage,
      qrUploadEnabled,
      setCurrentCollageFilename,
      resetCollageDirtyState,
      setIsGeneratingCollage,
      enqueuePhotos,
      showToast,
    ]
  );

  return { uploadCollage, isUploading };
}

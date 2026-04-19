import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getDriveAuthState, areUploadsEnabled } from '../../utils/driveAuthState';
import { imageCache } from '../../services/ImageCacheService';
import type { PhotoboothSessionInfo, PhotoboothSession } from '../../contexts/photobooth/PhotoboothSettingsContext';
import type { CurrentSetPhoto, DisplayMode } from '../../components/PhotoboothView/photoboothWorkspaceTypes';
import type { PlacedImage } from '../../types/collage';
import { createLogger } from '../../utils/logger';

const logger = createLogger('PhotoboothWorkspace');

function getNextSessionNumber(sessions: PhotoboothSessionInfo[]): number {
  if (sessions.length === 0) return 1;
  const numbers = sessions
    .map(s => {
      const match = s.folderName.match(/_(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter(n => n > 0);
  return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}

interface UseSessionWorkflowParams {
  workingFolder: string | null;
  sessions: PhotoboothSessionInfo[];
  currentSession: PhotoboothSession | null;
  loadSession: (sessionId: string) => Promise<void>;
  createNewSession: (name: string) => Promise<PhotoboothSessionInfo>;
  qrUploadEnabled: boolean;
  qrUploadAllImages: boolean;
  account: any;
  enqueuePhotos: (sessionId: string, photos: Array<{ filename: string; localPath: string }>, driveFolderId: string) => Promise<void>;
  currentSetPhotos: CurrentSetPhoto[];
  selectedPhotos: string[];
  placedImages: Map<string, PlacedImage>;
  setPlacedImages: (images: Map<string, PlacedImage>) => void;
  setFinalizeViewMode: (mode: 'capture' | 'finalize') => void;
  setFinalizeEditingZoneId: (id: string | null) => void;
  updateGuestDisplay: (data: {
    currentSetPhotos?: CurrentSetPhoto[];
    selectedPhotoIndex?: number | null;
    displayMode?: DisplayMode;
    showCapturePreview?: boolean;
    capturedPhotoUrl?: string | null;
    finalizeImageUrl?: string | null;
    finalizeQrData?: string | null;
  }) => void;
  updateDisplayMode: (mode: 'single' | 'center' | 'canvas' | 'finalize') => void;
  displayMode: DisplayMode;
  previousDisplayMode: DisplayMode;
  setPreviousDisplayMode: (mode: DisplayMode) => void;
  setDisplayMode: (mode: DisplayMode) => void;
  uploadCollage: (currentSession: PhotoboothSession, workingFolder: string, sessions: PhotoboothSessionInfo[], driveMetadata: any) => Promise<void>;
  setCurrentSetPhotos: (photos: CurrentSetPhoto[] | ((prev: CurrentSetPhoto[]) => CurrentSetPhoto[])) => void;
  setExpandedSets: (sets: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setSelectedSetId: (id: string | null) => void;
}

export function useSessionWorkflow({
  workingFolder,
  sessions,
  currentSession,
  loadSession,
  createNewSession,
  qrUploadEnabled,
  qrUploadAllImages,
  account,
  enqueuePhotos,
  currentSetPhotos,
  selectedPhotos,
  placedImages,
  setPlacedImages,
  setFinalizeViewMode,
  setFinalizeEditingZoneId,
  updateGuestDisplay,
  updateDisplayMode,
  displayMode,
  previousDisplayMode,
  setPreviousDisplayMode,
  setDisplayMode,
  uploadCollage,
  setCurrentSetPhotos,
  setExpandedSets,
  setSelectedSetId,
}: UseSessionWorkflowParams) {
  const [showSessionSelectModal, setShowSessionSelectModal] = useState(false);
  const [pendingSessionToLoad, setPendingSessionToLoad] = useState<PhotoboothSessionInfo | null>(null);
  const hasAutoLoadedRef = useRef(false);
  const [sessionQrData, setSessionQrData] = useState<string | null>(null);

  // Auto-load latest session when working folder changes
  useEffect(() => {
    const loadLatestSession = async () => {
      if (!workingFolder || sessions.length === 0) return;

      // If no current session and we haven't auto-loaded yet for this folder
      if (!currentSession && sessions.length > 0 && !hasAutoLoadedRef.current) {
        // Skip modal if there's only one empty session (just auto-created by refreshSessions)
        if (sessions.length === 1 && sessions[0].shotCount === 0) {
          logger.debug('[PhotoboothWorkspace] Single empty session detected, auto-loading without modal');
          hasAutoLoadedRef.current = true;
          await loadSession(sessions[0].id);
          return;
        }

        const latestSession = [...sessions].sort((a, b) =>
          new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
        )[0];

        logger.debug('[PhotoboothWorkspace] Found existing sessions, showing selection modal');
        hasAutoLoadedRef.current = true;
        setPendingSessionToLoad(latestSession);
        setShowSessionSelectModal(true);
      }
    };

    loadLatestSession();
  }, [workingFolder, sessions, currentSession]);

  // Reset auto-load flag when working folder changes
  useEffect(() => {
    hasAutoLoadedRef.current = false;
  }, [workingFolder]);

  // Auto-expand the current session when it changes (e.g., after finalize + next session)
  useEffect(() => {
    if (currentSession?.id) {
      setExpandedSets(new Set([currentSession.id]));
      setSelectedSetId(currentSession.id);
    }
  }, [currentSession?.id]);

  // Handler for creating next session
  const handleNextSession = useCallback(async () => {
    if (!workingFolder) return;

    try {
      const sessionName = `Session ${getNextSessionNumber(sessions)}`;
      logger.debug('[PhotoboothWorkspace] Creating next session:', sessionName);

      // Use createNewSession from context which includes Drive folder creation
      const newSession = await createNewSession(sessionName);

      logger.debug('[PhotoboothWorkspace] Created and switching to session:', newSession.id);

      // Load the new session
      await loadSession(newSession.id);

      // Clear current photos for the new session
      setCurrentSetPhotos([]);

      // Auto-select center stage mode for new session
      setDisplayMode('center');
      updateDisplayMode('center');
    } catch (error) {
      logger.error('[PhotoboothWorkspace] Error creating next session:', error);
    }
  }, [workingFolder, sessions, createNewSession, loadSession, setCurrentSetPhotos, setDisplayMode, updateDisplayMode]);

  // Handler for finalizing current session — switch to finalize view
  const handleFinalizeSession = useCallback(async () => {
    setFinalizeViewMode('finalize');
    // Always return to center stage mode after finalize
    setPreviousDisplayMode('center');
    setDisplayMode('finalize');

    // Generate QR code from session's Drive folder link if available
    const folderLink = currentSession?.googleDriveMetadata?.folderLink;
    logger.debug('[useSessionWorkflow::handleFinalizeSession] folderLink:', folderLink, 'accountId:', currentSession?.googleDriveMetadata?.accountId, 'currentAccount:', account?.email);
    if (folderLink) {
      try {
        const qrBase64 = await invoke<string>('generate_qr_code', { url: folderLink });
        logger.debug('[useSessionWorkflow::handleFinalizeSession] QR code generated successfully, length:', qrBase64.length);
        setSessionQrData(qrBase64);
      } catch (err) {
        logger.error('[PhotoboothWorkspace] Failed to generate QR code:', err);
        setSessionQrData(null);
      }
    } else {
      logger.debug('[useSessionWorkflow::handleFinalizeSession] No folderLink, setting sessionQrData to null');
      setSessionQrData(null);
    }

    // Upload photos to Google Drive if configured and account matches
    const driveAuthState = getDriveAuthState(currentSession?.googleDriveMetadata, account);
    if (qrUploadEnabled && account && currentSession?.googleDriveMetadata?.folderId && workingFolder && areUploadsEnabled(driveAuthState.state)) {
      const driveFolderId = currentSession.googleDriveMetadata.folderId;

      try {
        let photoFilenames: string[] = [];

        if (qrUploadAllImages) {
          // Upload all photos from current session
          logger.debug('[PhotoboothWorkspace::handleFinalizeSession] Uploading all session photos to Drive');
          photoFilenames = currentSetPhotos.map(photo => photo.filename);
        } else {
          // Upload only selected photos
          logger.debug('[PhotoboothWorkspace::handleFinalizeSession] Uploading selected photos to Drive');

          // Check if we have placed images (on finalize screen) or selected photos (on capture screen)
          if (placedImages.size > 0) {
            // Use placed images from collage
            photoFilenames = Array.from(placedImages.values())
              .map(img => {
                // Extract filename from source file path (handles both asset:// and file paths)
                const parts = img.sourceFile.split('/');
                return parts[parts.length - 1];
              })
              .filter(Boolean);
          } else if (selectedPhotos.length > 0) {
            // Use selected photos from photo strip (preserving click order)
            const selectedPhotosList = selectedPhotos.map(id => currentSetPhotos.find(p => p.id === id)).filter(Boolean) as CurrentSetPhoto[];
            photoFilenames = selectedPhotosList.map(photo => photo.filename);
          }
        }

        if (photoFilenames.length === 0) {
          logger.debug('[PhotoboothWorkspace::handleFinalizeSession] No photos to upload');
          return;
        }

        logger.debug('[PhotoboothWorkspace::handleFinalizeSession] Found photos to upload:', photoFilenames);

        // Build full photo objects with local paths
        const photosToUpload = [];
        const sessionFolderName = sessions.find(s => s.id === currentSession.id)?.folderName || currentSession.id;

        for (const filename of photoFilenames) {
          // Check if already uploaded
          const alreadyUploaded = await invoke<boolean>('is_image_uploaded_to_drive', {
            folderPath: workingFolder,
            sessionId: currentSession.id,
            filename,
          });

          if (!alreadyUploaded) {
            const localPath = `${workingFolder}/${sessionFolderName}/${filename}`;
            photosToUpload.push({ filename, localPath });
          } else {
            logger.debug('[PhotoboothWorkspace::handleFinalizeSession] Already uploaded:', filename);
          }
        }

        if (photosToUpload.length > 0) {
          logger.debug(`[PhotoboothWorkspace::handleFinalizeSession] Queueing ${photosToUpload.length} photos for upload`);
          await enqueuePhotos(currentSession.id, photosToUpload, driveFolderId);
        } else {
          logger.debug('[PhotoboothWorkspace::handleFinalizeSession] All photos already uploaded');
        }
      } catch (error) {
        logger.error('[PhotoboothWorkspace::handleFinalizeSession] Upload error:', error);
      }
    } else {
      logger.debug('[PhotoboothWorkspace::handleFinalizeSession] Skipping upload - Drive not configured or account mismatch');
    }
  }, [currentSession, workingFolder, sessions, qrUploadEnabled, qrUploadAllImages, account, enqueuePhotos, currentSetPhotos, selectedPhotos, placedImages, setFinalizeViewMode, displayMode, setPreviousDisplayMode, setDisplayMode]);

  // Handler for uploading the final collage to Google Drive (uses shared hook)
  const handleUploadCollage = useCallback(async () => {
    if (!currentSession?.googleDriveMetadata) return;
    await uploadCollage(currentSession, workingFolder!, sessions, currentSession.googleDriveMetadata);
  }, [currentSession, workingFolder, sessions, uploadCollage]);

  const handleBackToCapture = useCallback(() => {
    logger.debug('[handleBackToCapture] BACK BUTTON CLICKED');
    logger.debug('[handleBackToCapture] previousDisplayMode:', previousDisplayMode);

    setFinalizeViewMode('capture');
    setFinalizeEditingZoneId(null);
    setSessionQrData(null);

    // Restore guest display to previous mode and clear finalize image
    setDisplayMode(previousDisplayMode);

    // Explicitly update the display mode on guest display
    updateDisplayMode(previousDisplayMode);

    // Clear the finalize image and QR data
    updateGuestDisplay({
      displayMode: previousDisplayMode,
      finalizeImageUrl: null,
      finalizeQrData: null,
    });
  }, [previousDisplayMode, setPlacedImages, setFinalizeViewMode, setFinalizeEditingZoneId, setDisplayMode, updateDisplayMode, updateGuestDisplay]);

  // Handler for continuing the last session
  const handleContinueSession = useCallback(async () => {
    if (pendingSessionToLoad) {
      await loadSession(pendingSessionToLoad.id);
      setShowSessionSelectModal(false);
      setPendingSessionToLoad(null);
    }
  }, [pendingSessionToLoad, loadSession]);

  // Handler for creating a new session
  const handleCreateNewSession = useCallback(async () => {
    if (!workingFolder) return;

    try {
      const sessionName = `Session ${getNextSessionNumber(sessions)}`;
      logger.debug('[PhotoboothWorkspace] Creating new session:', sessionName);

      // Clear placed images cache and image cache when creating new session
      setPlacedImages(new Map());
      imageCache.clearCache();

      const newSession = await createNewSession(sessionName);

      // Load the new session
      await loadSession(newSession.id);

      // Clear current photos for the new session
      setCurrentSetPhotos([]);

      setShowSessionSelectModal(false);
      setPendingSessionToLoad(null);
    } catch (error) {
      logger.error('[PhotoboothWorkspace] Error creating new session:', error);
    }
  }, [workingFolder, sessions, createNewSession, loadSession, setCurrentSetPhotos, setPlacedImages]);

  return {
    showSessionSelectModal,
    pendingSessionToLoad,
    sessionQrData,
    handleNextSession,
    handleFinalizeSession,
    handleUploadCollage,
    handleBackToCapture,
    handleContinueSession,
    handleCreateNewSession,
  };
}

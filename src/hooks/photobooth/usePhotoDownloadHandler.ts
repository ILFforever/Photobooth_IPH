import { useEffect, useCallback } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { type PhotoDownloadedEvent } from '../../services/cameraWebSocket';
import type { PhotoboothSession, PhotoboothSessionInfo } from '../../contexts/photobooth/PhotoboothSettingsContext';
import type { CurrentSetPhoto, PtbSession, DisplayMode } from '../../components/PhotoboothView/photoboothWorkspaceTypes';
import { createLogger } from '../../utils/logger';
import { useToast } from '../../contexts';

const logger = createLogger('PhotoboothWorkspace');

const DAEMON_URL = 'http://localhost:58321';

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

interface UsePhotoDownloadHandlerParams {
  workingFolder: string | null;
  currentSession: PhotoboothSession | null;
  sessions: PhotoboothSessionInfo[];
  photoNamingScheme: string;
  qrUploadEnabled: boolean;
  qrUploadAllImages: boolean;
  account: any;
  sequenceNotifyCaptureComplete: () => void;
  sequenceIsActive: boolean;
  sequenceStartManualReview: () => void;
  updateCurrentSessionFromDownload: (ptbSession: PhotoboothSession, newPhotoFilename?: string) => void;
  loadSession: (sessionId: string) => Promise<void>;
  enqueuePhotos: (sessionId: string, photos: Array<{ filename: string; localPath: string }>, driveFolderId: string) => Promise<void>;
  updateGuestDisplay: (data: {
    currentSetPhotos?: CurrentSetPhoto[];
    selectedPhotoIndex?: number | null;
    displayMode?: DisplayMode;
    showCapturePreview?: boolean;
    capturedPhotoUrl?: string | null;
  }) => void;
  setCapturedPhotoUrl: (url: string | null) => void;
  setShowCapturePreview: (show: boolean) => void;
  previewTimerStartedRef: React.MutableRefObject<boolean>;
  currentSetPhotos: CurrentSetPhoto[];
  selectedPhotoIndex: number | null;
  displayMode: DisplayMode;
  setCurrentSetPhotos: (photos: CurrentSetPhoto[] | ((prev: CurrentSetPhoto[]) => CurrentSetPhoto[])) => void;
  addPhotoDownloadedListener: (listener: (event: PhotoDownloadedEvent) => void) => void;
  removePhotoDownloadedListener: (listener: (event: PhotoDownloadedEvent) => void) => void;
}

export function usePhotoDownloadHandler({
  workingFolder,
  currentSession,
  sessions,
  photoNamingScheme,
  qrUploadEnabled,
  qrUploadAllImages,
  account,
  sequenceNotifyCaptureComplete,
  sequenceIsActive,
  sequenceStartManualReview,
  updateCurrentSessionFromDownload,
  loadSession,
  enqueuePhotos,
  updateGuestDisplay,
  setCapturedPhotoUrl,
  setShowCapturePreview,
  previewTimerStartedRef,
  currentSetPhotos,
  selectedPhotoIndex,
  displayMode,
  setCurrentSetPhotos,
  addPhotoDownloadedListener,
  removePhotoDownloadedListener,
}: UsePhotoDownloadHandlerParams) {
  const { showToast } = useToast();

  // Handle photo_downloaded events from WebSocket
  const handlePhotoDownloaded = useCallback(async (event: PhotoDownloadedEvent) => {
    logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] START');
    logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] event:', event);

    // Immediately advance the sequence state machine (adds placeholder + moves to review/next)
    // This decouples state progression from the slower download pipeline
    sequenceNotifyCaptureComplete();

    const filename = event.file_path.split('/').pop() || event.file_path;
    logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] extracted filename:', filename);

    if (!workingFolder) {
      // Show warning toast if working folder is not set
      logger.warn('[PhotoboothWorkspace::handlePhotoDownloaded] Working folder not set, cannot save photo');
      showToast('No Working Folder Set', 'warning', 5000, 'Select a folder in Photobooth settings');
      return;
    }

    try {
      let sessionId = currentSession?.id;
      logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] initial sessionId:', sessionId);

      // Auto-create session if none exists
      if (!sessionId) {
        logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] No active session - auto-creating new session');

        const sessionName = `Session ${getNextSessionNumber(sessions)}`;
        logger.debug('[PhotoboothWorkspace] Creating session:', sessionName);

        // Create the new session using the backend command
        const newSession = await invoke<{ id: string; name: string; folderName: string }>('create_photobooth_session', {
          folderPath: workingFolder,
          sessionName,
        });

        sessionId = newSession.id;
        logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] Created session:', sessionId);

        // Load the newly created session as current
        await loadSession(sessionId);
        logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] Loaded new session');
      }

      logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] Calling download_photo_from_daemon with:', {
        daemonUrl: DAEMON_URL,
        filename,
        folderPath: workingFolder,
        sessionId,
        cameraPath: event.camera_path,
        originalDaemonPath: event.file_path,
      });

      // Download photo directly via Rust (bypasses slow JS ArrayBuffer -> Array conversion)
      const updatedSession = await invoke<PtbSession>('download_photo_from_daemon', {
        daemonUrl: DAEMON_URL,
        filename,
        folderPath: workingFolder,
        sessionId,
        cameraPath: event.camera_path,
        originalDaemonPath: event.file_path,
        photoNamingScheme,
      });

      logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] Photo saved, session updated:', updatedSession);

      // PRIORITY 1: Show full-res photo on guest display immediately (do this first!)
      const latestPhoto = updatedSession.photos[updatedSession.photos.length - 1];
      const customFilename = latestPhoto?.filename || filename;
      const sessionInfo = sessions.find(s => s.id === sessionId);
      const folderName = sessionInfo?.folderName || sessionId;
      const photoPath = `${workingFolder}/${folderName}/${customFilename}`;
      const photoUrl = convertFileSrc(photoPath);

      logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] Showing photo on guest display immediately');

      // Reset flag for new photo
      previewTimerStartedRef.current = false;

      // Update main workspace state first (for guest display sync)
      // NOTE: Timer will be started when onCapturePreviewLoad is called (after image loads)
      setCapturedPhotoUrl(photoUrl);
      setShowCapturePreview(true);

      // Send to guest display IMMEDIATELY - don't wait for anything else
      updateGuestDisplay({
        currentSetPhotos,
        selectedPhotoIndex,
        displayMode,
        showCapturePreview: true,
        capturedPhotoUrl: photoUrl,
      });

      // Start manual review mode if not in automatic sequence
      if (!sequenceIsActive) {
        logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] Manual capture - starting manual review mode');
        sequenceStartManualReview();
      }

      // Create new photo entry for current set
      const newPhoto: CurrentSetPhoto = {
        id: customFilename,
        thumbnailUrl: photoUrl, // Use full-res for display quality
        fullUrl: photoUrl,
        timestamp: new Date().toLocaleTimeString(),
      };

      // Update current set photos (main workspace display)
      setCurrentSetPhotos(prev => {
        const placeholderIndex = prev.findIndex(p => p.thumbnailUrl.startsWith('data:image/svg+xml'));
        if (placeholderIndex !== -1) {
          // Replace the placeholder with the real photo
          const updated = [...prev];
          updated[placeholderIndex] = newPhoto;
          logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] Replaced placeholder at index:', placeholderIndex);
          return updated;
        }
        // If no placeholder found, append the new photo
        logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] No placeholder found, appending photo');
        return [...prev, newPhoto];
      });

      // PRIORITY 2 (LOW): Update session state in background (non-blocking)
      // Don't await this - let it complete in background
      updateCurrentSessionFromDownload({
        id: sessionId!,
        name: updatedSession.name,
        createdAt: updatedSession.createdAt,
        lastUsedAt: updatedSession.lastUsedAt,
        shotCount: updatedSession.shotCount,
        photos: updatedSession.photos,
        googleDriveMetadata: updatedSession.googleDriveMetadata || { uploadedImages: [] },
      }, customFilename);
      logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] Session state updated directly');

      // PRIORITY 3: Auto-upload to Google Drive (non-blocking)
      // Only if user is logged in, Drive folder is configured, AND "Upload all images" is enabled
      if (qrUploadEnabled && account && updatedSession.googleDriveMetadata?.folderId && qrUploadAllImages) {
        const driveFolderId = updatedSession.googleDriveMetadata.folderId;
        logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] Auto-uploading to Drive folder:', driveFolderId);

        // Check if photo was already uploaded
        try {
          const alreadyUploaded = await invoke<boolean>('is_image_uploaded_to_drive', {
            folderPath: workingFolder,
            sessionId: sessionId!,
            filename: customFilename,
          });

          if (!alreadyUploaded) {
            // Queue single photo for upload immediately (don't await - let it process in background)
            enqueuePhotos(sessionId!, [{
              filename: customFilename,
              localPath: photoPath
            }], driveFolderId).catch(err => {
              logger.error('[PhotoboothWorkspace::handlePhotoDownloaded] Upload queue error:', err);
            });
            logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] Photo queued for immediate upload:', customFilename);
          } else {
            logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] Photo already uploaded, skipping:', customFilename);
          }
        } catch (error) {
          logger.error('[PhotoboothWorkspace::handlePhotoDownloaded] Upload check error:', error);
        }
      } else {
        if (!account) {
          logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] Skipping auto-upload - Not logged in to Google Drive');
        } else if (!updatedSession.googleDriveMetadata?.folderId) {
          logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] Skipping auto-upload - Drive folder not configured for this session');
        } else if (!qrUploadAllImages) {
          logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] Skipping auto-upload - "Selected Collage Photos Only" mode (will upload on finalize)');
        }
      }

      logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] END - photo displayed immediately');
    } catch (error) {
      logger.error('[PhotoboothWorkspace::handlePhotoDownloaded] ERROR:', error);
    }
    logger.debug('[PhotoboothWorkspace::handlePhotoDownloaded] END');
  }, [workingFolder, currentSession, sessions, updateCurrentSessionFromDownload, loadSession, sequenceNotifyCaptureComplete, updateGuestDisplay, currentSetPhotos, selectedPhotoIndex, displayMode, account, qrUploadAllImages, enqueuePhotos]);

  // Subscribe to photo_downloaded events
  useEffect(() => {
    addPhotoDownloadedListener(handlePhotoDownloaded);
    return () => {
      removePhotoDownloadedListener(handlePhotoDownloaded);
    };
  }, [handlePhotoDownloaded, addPhotoDownloadedListener, removePhotoDownloadedListener]);
}

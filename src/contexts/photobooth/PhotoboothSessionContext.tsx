import { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from "react";
import { invoke } from '@tauri-apps/api/core';
import { useToast } from "../system";
import * as sessionDrive from '../../utils/sessionDrive';
import { useAuth } from "../auth";
import { useCaptureTiming } from "./PhotoboothCaptureSettingsContext";
import { useWorkspaceSettings } from "./PhotoboothWorkspaceSettingsContext";
import { createLogger } from "../../utils/logger";
import type {
  DriveUploadedImage,
  GoogleDriveMetadata,
  PhotoboothSessionInfo,
  SessionPhoto,
  PhotoboothSession,
  LastGeneratedMedia,
} from "./PhotoboothSettingsContext";

const logger = createLogger('PhotoboothSettingsContext');

export interface PhotoboothSessionContextType {
  currentSession: PhotoboothSession | null;
  sessions: PhotoboothSessionInfo[];
  refreshSessions: () => Promise<void>;
  createNewSession: (name: string) => Promise<PhotoboothSessionInfo>;
  deleteSession: (sessionId: string) => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  setCurrentSession: (sessionId: string) => Promise<void>;
  updateSessionShotCount: (sessionId: string, shotCount: number) => void;
  updateCurrentSessionFromDownload: (ptbSession: PhotoboothSession, newPhotoFilename?: string) => void;
  isLoadingSessions: boolean;
  // Google Drive metadata management
  updateSessionDriveFolder: (sessionId: string, folderId: string | null, folderName: string | null, folderLink: string | null, accountId?: string | null) => Promise<void>;
  addDriveUploadToSession: (sessionId: string, filename: string, driveFileId: string) => Promise<void>;
  checkImageUploadedToDrive: (sessionId: string, filename: string) => Promise<boolean>;
  clearDriveUploadsForSession: (sessionId: string) => Promise<void>;
  createDriveFolderForSession: (sessionId: string, sessionName: string) => Promise<void>;
  deleteDriveFolderForSession: (sessionId: string, folderId: string | null, sessionName: string) => Promise<void>;
  // Photo management
  deleteSessionPhoto: (sessionId: string, filename: string) => Promise<void>;
  // Last generated media
  lastGeneratedMedia: LastGeneratedMedia | null;
  setLastGif: (gif: { filePath: string; fileName: string; fileSize: number; photoCount: number }) => void;
  setLastVideo: (video: { filePath: string; fileName: string; fileSize: number; photoCount: number }) => void;
  clearLastGenerated: () => void;
}

const PhotoboothSessionContext = createContext<PhotoboothSessionContextType | undefined>(undefined);

export function PhotoboothSessionProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
  const { account, rootFolder } = useAuth();
  const {
    autoCount, timerDelay, delayBetweenPhotos, photoReviewTime,
    setAutoCount, setTimerDelay, setDelayBetweenPhotos, setPhotoReviewTime,
    setDelaySettingsLoaded,
  } = useCaptureTiming();
  const {
    workingFolder, setWorkingFolder,
    qrUploadEnabled, qrUploadAllImages, photoNamingScheme,
    autoGifEnabled, autoGifFormat, autoGifPhotoSource,
    setQrUploadEnabled, setQrUploadAllImages, setPhotoNamingScheme,
    setAutoGifEnabled, setAutoGifFormat, setAutoGifPhotoSource,
    borderFit, borderTopBottom, borderSides, exportResolutionMp,
    setBorderFit, setBorderTopBottom, setBorderSides, setExportResolutionMp,
  } = useWorkspaceSettings();

  // Ref to always have latest settings without adding them as refreshSessions deps
  const currentSettingsRef = useRef({
    autoCount, timerDelay, delayBetweenPhotos, photoReviewTime,
    qrUploadEnabled, qrUploadAllImages, photoNamingScheme,
    autoGifEnabled, autoGifFormat, autoGifPhotoSource,
    borderFit, borderTopBottom, borderSides, exportResolutionMp,
  });
  currentSettingsRef.current = {
    autoCount, timerDelay, delayBetweenPhotos, photoReviewTime,
    qrUploadEnabled, qrUploadAllImages, photoNamingScheme,
    autoGifEnabled, autoGifFormat, autoGifPhotoSource,
    borderFit, borderTopBottom, borderSides, exportResolutionMp,
  };

  // Session management state
  const [currentSession, setCurrentSession] = useState<PhotoboothSession | null>(null);
  const [sessions, setSessions] = useState<PhotoboothSessionInfo[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  // Last generated media state
  const [lastGeneratedMedia, setLastGeneratedMedia] = useState<LastGeneratedMedia | null>(null);

  // Track last folder to detect when folder changes
  const lastFolderRef = useRef<string | null>(null);

  // Helper function to create Drive folder for a session with validation and alerts
  const createDriveFolderForSession = useCallback(async (
    sessionId: string,
    sessionName: string
  ): Promise<void> => {
    logger.debug('[createDriveFolderForSession] Called with:', { sessionId, sessionName, account, workingFolder, rootFolder });

    // Check if user is logged in
    if (!account) {
      logger.debug('[createDriveFolderForSession] No account, showing warning');
      showToast(
        'Google Drive Not Connected',
        'warning',
        5000,
        'Please login to Google Drive to auto-create session folders'
      );
      return;
    }

    // Check if working folder is set
    if (!workingFolder) {
      logger.debug('[createDriveFolderForSession] No working folder, showing warning');
      showToast(
        'Working Folder Not Set',
        'warning',
        5000,
        'Please set a working folder in Photobooth Settings'
      );
      return;
    }

    // Check if Drive root folder is set
    if (!rootFolder) {
      logger.debug('[createDriveFolderForSession] No root folder, showing warning');
      showToast(
        'Drive Folder Not Configured',
        'warning',
        5000,
        'Please select a Google Drive folder in Photobooth Settings > QR Settings'
      );
      return;
    }

    logger.debug('[createDriveFolderForSession] All validations passed, creating Drive folder...');
    try {
      await sessionDrive.initializeSessionDriveFolder(
        workingFolder,
        sessionId,
        rootFolder.id,
        account?.email
      );
      showToast(
        'Drive Folder Created',
        'success',
        4000,
        `Folder created for session: ${sessionName}`
      );
      // Refresh sessions to update UI with new Drive metadata
      await refreshSessions();
    } catch (error) {
      logger.error('Failed to create Drive folder:', error);
      showToast(
        'Failed to Create Drive Folder',
        'error',
        5000,
        error instanceof Error ? error.message : 'Unknown error occurred'
      );
    }
  }, [account, workingFolder, rootFolder, showToast]);

  // Refresh the list of sessions
  const refreshSessions = useCallback(async () => {
    if (!workingFolder) return;

    try {
      setIsLoadingSessions(true);
      const [sessionList, ptbCreated] = await invoke<[PhotoboothSessionInfo[], boolean]>('list_photobooth_sessions', {
        folderPath: workingFolder,
      });
      setSessions(sessionList);

      if (ptbCreated) {
        // New folder — save the user's current settings into it instead of applying defaults
        const s = currentSettingsRef.current;
        try {
          await invoke('save_delay_settings', {
            folderPath: workingFolder,
            delaySettings: {
              autoCount: s.autoCount,
              timerDelay: s.timerDelay,
              delayBetweenPhotos: s.delayBetweenPhotos,
              photoReviewTime: s.photoReviewTime,
            },
          });
          await invoke('save_photobooth_settings', {
            folderPath: workingFolder,
            photoboothSettings: {
              qrUploadEnabled: s.qrUploadEnabled,
              qrUploadAllImages: s.qrUploadAllImages,
              photoNamingScheme: s.photoNamingScheme,
            },
          });
          await invoke('save_gif_settings', {
            folderPath: workingFolder,
            gifSettings: {
              autoGifEnabled: s.autoGifEnabled,
              autoGifFormat: s.autoGifFormat,
              autoGifPhotoSource: s.autoGifPhotoSource,
            },
          });
          await invoke('save_print_settings', {
            folderPath: workingFolder,
            printSettings: {
              borderFit: s.borderFit,
              borderTopBottom: s.borderTopBottom,
              borderSides: s.borderSides,
              exportResolutionMp: s.exportResolutionMp,
            },
          });
        } catch (err) {
          logger.error('Failed to save settings to new folder:', err);
        }
        setDelaySettingsLoaded(true);
      } else {
        // Existing folder — load and apply its saved settings
        const workspace = await invoke<any>('load_ptb_workspace', {
          folderPath: workingFolder,
        });

        if (workspace.delaySettings) {
          const { autoCount: ac, timerDelay: td, delayBetweenPhotos: dbp, photoReviewTime: prt } = workspace.delaySettings;
          const newSettings = {
            autoCount: ac ?? 3,
            timerDelay: td ?? 3,
            delayBetweenPhotos: dbp ?? 3,
            photoReviewTime: prt ?? 3,
          };
          setAutoCount(newSettings.autoCount);
          setTimerDelay(newSettings.timerDelay);
          setDelayBetweenPhotos(newSettings.delayBetweenPhotos);
          setPhotoReviewTime(newSettings.photoReviewTime);
          setDelaySettingsLoaded(true);

          if (lastFolderRef.current !== workingFolder) {
            showToast(
              'Settings Applied',
              'info',
              4000,
              `Loaded: ${newSettings.autoCount} photos, ${newSettings.timerDelay}s start, ${newSettings.delayBetweenPhotos}s between, ${newSettings.photoReviewTime}s review`
            );
          }
        } else {
          setDelaySettingsLoaded(false);
        }

        if (workspace.photoboothSettings) {
          const { qrUploadEnabled, qrUploadAllImages, photoNamingScheme } = workspace.photoboothSettings;
          setQrUploadEnabled(qrUploadEnabled ?? true);
          setQrUploadAllImages(qrUploadAllImages ?? false);
          setPhotoNamingScheme(photoNamingScheme ?? 'IPH_{number}');
        }

        if (workspace.gifSettings) {
          const { autoGifEnabled, autoGifFormat, autoGifPhotoSource } = workspace.gifSettings;
          setAutoGifEnabled(autoGifEnabled ?? false);
          setAutoGifFormat(autoGifFormat ?? 'both');
          setAutoGifPhotoSource(autoGifPhotoSource ?? 'collage');
        }

        if (workspace.printSettings) {
          const { borderFit, borderTopBottom, borderSides, exportResolutionMp } = workspace.printSettings;
          setBorderFit(borderFit ?? false);
          setBorderTopBottom(borderTopBottom ?? 0.08);
          setBorderSides(borderSides ?? 0.05);
          setExportResolutionMp(exportResolutionMp ?? 15);
        }

        // Show sessions-loaded toast only when no settings toast was shown
        if (lastFolderRef.current !== workingFolder && !workspace.delaySettings) {
          const sessionCount = sessionList.length;
          showToast(`${sessionCount} session${sessionCount !== 1 ? 's' : ''} loaded`, 'info', 3000);
        }
      }

      // If no sessions exist, create one automatically
      if (sessionList.length === 0) {
        const newSession = await invoke<PhotoboothSessionInfo>('create_photobooth_session', {
          folderPath: workingFolder,
          sessionName: 'Session 1',
        });
        setSessions([newSession]);

        // Load the new session as current
        const ptbSession = await invoke<any>('get_session_data', {
          folderPath: workingFolder,
          sessionId: newSession.id,
        });
        setCurrentSession({
          id: ptbSession.id,
          name: ptbSession.name,
          createdAt: ptbSession.createdAt,
          lastUsedAt: ptbSession.lastUsedAt,
          shotCount: ptbSession.shotCount,
          photos: ptbSession.photos,
          googleDriveMetadata: ptbSession.googleDriveMetadata || { uploadedImages: [] },
        });

        showToast('New workspace created', 'success', 3000, 'Session 1 ready');
        lastFolderRef.current = workingFolder;
        setIsLoadingSessions(false);

        // Create Drive folder for the new session
        await createDriveFolderForSession(newSession.id, newSession.name);
        return;
      }

      // Show toast for new workspace (settings toast for existing folders is shown above)
      if (ptbCreated) {
        showToast('New workspace created', 'success', 3000, 'Ready to start capturing photos');
      }
      lastFolderRef.current = workingFolder;

      // Also update current session if we have one
      const currentSessionInfo = await invoke<PhotoboothSessionInfo | null>('get_current_session', {
        folderPath: workingFolder,
      });

      if (currentSessionInfo) {
        // Load the full session data from root .ptb file
        const ptbSession = await invoke<any>('get_session_data', {
          folderPath: workingFolder,
          sessionId: currentSessionInfo.id,
        });
        setCurrentSession({
          id: ptbSession.id,
          name: ptbSession.name,
          createdAt: ptbSession.createdAt,
          lastUsedAt: ptbSession.lastUsedAt,
          shotCount: ptbSession.shotCount,
          photos: ptbSession.photos,
          googleDriveMetadata: ptbSession.googleDriveMetadata || { uploadedImages: [] },
        });
      }
    } catch (error) {
      logger.error('Failed to refresh sessions:', error);
      const msg = typeof error === 'string' ? error : (error instanceof Error ? error.message : 'Unknown error');
      showToast('Failed to load workspace', 'error', 10000, msg);
      setWorkingFolder(null);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [workingFolder, showToast, setAutoCount, setTimerDelay, setDelayBetweenPhotos, setPhotoReviewTime, createDriveFolderForSession]);

  // Create a new session
  const createNewSession = useCallback(async (name: string) => {
    if (!workingFolder) {
      throw new Error('Working folder must be set first');
    }

    const sessionInfo = await invoke<PhotoboothSessionInfo>('create_photobooth_session', {
      folderPath: workingFolder,
      sessionName: name,
    });

    await refreshSessions();

    // Create Drive folder for the new session
    await createDriveFolderForSession(sessionInfo.id, sessionInfo.name);

    return sessionInfo;
  }, [workingFolder, refreshSessions, createDriveFolderForSession]);

  // Delete a session
  const deleteSession = useCallback(async (sessionId: string) => {
    if (!workingFolder) {
      throw new Error('Working folder must be set first');
    }

    await invoke('delete_photobooth_session', {
      folderPath: workingFolder,
      sessionId,
    });

    // Refresh sessions to update UI
    await refreshSessions();

    // If the deleted session was the current session, clear it
    if (currentSession?.id === sessionId) {
      setCurrentSession(null);
    }
  }, [workingFolder, refreshSessions, currentSession]);

  // Load a session's data
  const loadSession = useCallback(async (sessionId: string) => {
    if (!workingFolder) return;

    try {
      const ptbSession = await invoke<any>('get_session_data', {
        folderPath: workingFolder,
        sessionId,
      });

      setCurrentSession({
        id: ptbSession.id,
        name: ptbSession.name,
        createdAt: ptbSession.createdAt,
        lastUsedAt: ptbSession.lastUsedAt,
        shotCount: ptbSession.shotCount,
        photos: ptbSession.photos,
        googleDriveMetadata: ptbSession.googleDriveMetadata || { uploadedImages: [] },
      });

      // Also set as current session in workspace
      await invoke('set_current_session', {
        folderPath: workingFolder,
        sessionId,
      });
    } catch (error) {
      logger.error('Failed to load session:', error);
      throw error;
    }
  }, [workingFolder]);

  // Set a session as current without loading full data
  const setCurrentSessionId = useCallback(async (sessionId: string) => {
    if (!workingFolder) return;

    await invoke('set_current_session', {
      folderPath: workingFolder,
      sessionId,
    });

    await refreshSessions();
  }, [workingFolder, refreshSessions]);

  // Update a session's shot count in the sessions list (avoids full refresh)
  const updateSessionShotCount = useCallback((sessionId: string, shotCount: number) => {
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, shotCount, lastUsedAt: new Date().toISOString() } : s
    ));
  }, []);

  // Update current session from download response (avoids full refresh)
  const updateCurrentSessionFromDownload = useCallback(async (ptbSession: PhotoboothSession, newPhotoFilename?: string) => {
    setCurrentSession(ptbSession);

    // If a new photo was added, generate its thumbnail and update the sessions list
    if (workingFolder && newPhotoFilename) {
      const folderName = ptbSession.id; // Session ID matches folder name

      try {
        // Generate thumbnail for the new photo only
        const imagePath = `${workingFolder}/${folderName}/${newPhotoFilename}`;
        const thumbnail = await invoke<string>('generate_cached_thumbnail', { imagePath });

        setSessions(prev => prev.map(s =>
          s.id === ptbSession.id
            ? {
                ...s,
                shotCount: ptbSession.shotCount,
                lastUsedAt: ptbSession.lastUsedAt,
                thumbnails: [...s.thumbnails, thumbnail]
              }
            : s
        ));
      } catch (error) {
        // Still update shotCount even if thumbnail generation fails
        setSessions(prev => prev.map(s =>
          s.id === ptbSession.id
            ? { ...s, shotCount: ptbSession.shotCount, lastUsedAt: ptbSession.lastUsedAt }
            : s
        ));
      }
    } else {
      // No new photo, just update shotCount and lastUsedAt
      setSessions(prev => prev.map(s =>
        s.id === ptbSession.id
          ? { ...s, shotCount: ptbSession.shotCount, lastUsedAt: ptbSession.lastUsedAt }
          : s
      ));
    }
  }, [workingFolder]);

  // Google Drive metadata management functions
  const updateSessionDriveFolder = useCallback(async (
    sessionId: string,
    folderId: string | null,
    folderName: string | null,
    folderLink: string | null,
    accountId?: string | null
  ) => {
    if (!workingFolder) {
      throw new Error('Working folder must be set first');
    }

    await sessionDrive.updateSessionDriveMetadata(
      workingFolder,
      sessionId,
      folderId,
      folderName,
      folderLink,
      accountId
    );

    // Update the session in the local state
    setSessions(prev => prev.map(s =>
      s.id === sessionId
        ? {
            ...s,
            googleDriveMetadata: {
              ...s.googleDriveMetadata,
              folderId,
              folderName,
              folderLink,
              accountId,
            }
          }
        : s
    ));
  }, [workingFolder]);

  const addDriveUploadToSession = useCallback(async (
    sessionId: string,
    filename: string,
    driveFileId: string
  ) => {
    if (!workingFolder) {
      throw new Error('Working folder must be set first');
    }

    await sessionDrive.addSessionDriveUpload(
      workingFolder,
      sessionId,
      filename,
      driveFileId
    );

    // Update the session in the local state
    const uploadedAt = new Date().toISOString();
    setSessions(prev => prev.map(s =>
      s.id === sessionId
        ? {
            ...s,
            googleDriveMetadata: {
              ...s.googleDriveMetadata,
              uploadedImages: [
                ...s.googleDriveMetadata.uploadedImages,
                { filename, driveFileId, uploadedAt }
              ]
            }
          }
        : s
    ));
  }, [workingFolder]);

  const checkImageUploadedToDrive = useCallback(async (
    sessionId: string,
    filename: string
  ): Promise<boolean> => {
    if (!workingFolder) {
      return false;
    }

    return await sessionDrive.isImageUploadedToDrive(
      workingFolder,
      sessionId,
      filename
    );
  }, [workingFolder]);

  const clearDriveUploadsForSession = useCallback(async (sessionId: string) => {
    if (!workingFolder) {
      throw new Error('Working folder must be set first');
    }

    await sessionDrive.clearSessionDriveUploads(workingFolder, sessionId);

    // Update the session in the local state
    setSessions(prev => prev.map(s =>
      s.id === sessionId
        ? {
            ...s,
            googleDriveMetadata: {
              ...s.googleDriveMetadata,
              uploadedImages: []
            }
          }
        : s
    ));
  }, [workingFolder]);

  // Delete Drive folder for a session
  const deleteDriveFolderForSession = useCallback(async (
    sessionId: string,
    folderId: string | null,
    sessionName: string
  ): Promise<void> => {
    if (!account) {
      showToast(
        'Google Drive Not Connected',
        'warning',
        5000,
        'Please login to Google Drive to delete session folders'
      );
      return;
    }

    try {
      // If folderId exists, try to delete the actual folder from Google Drive
      if (folderId) {
        const { deleteDriveFolder } = await import('../../utils/driveFolder');
        await deleteDriveFolder(folderId);
      }

      // Clear the Drive metadata from the session
      await updateSessionDriveFolder(sessionId, null, null, null);

      // Clear uploaded images tracking
      await clearDriveUploadsForSession(sessionId);

      showToast(
        'Drive Folder Removed',
        'success',
        4000,
        `Folder removed for session: ${sessionName}`
      );
    } catch (error) {
      logger.error('Failed to delete Drive folder:', error);
      showToast(
        'Failed to Remove Drive Folder',
        'error',
        5000,
        error instanceof Error ? error.message : 'Unknown error occurred'
      );
    }
  }, [account, showToast, updateSessionDriveFolder, clearDriveUploadsForSession]);

  // Delete a single photo from a session
  const deleteSessionPhoto = useCallback(async (
    sessionId: string,
    filename: string
  ): Promise<void> => {
    if (!workingFolder) {
      throw new Error('Working folder must be set first');
    }

    try {
      // Call Rust backend to delete the photo
      const updatedSession = await invoke<any>('delete_session_photo', {
        folderPath: workingFolder,
        sessionId,
        filename,
      });

      // Get the session folder name to match thumbnail paths correctly
      // Thumbnail format is: asset://path/to/cached_thumb_{folderName}--{filename}
      const sessionInfo = sessions.find(s => s.id === sessionId);
      const folderName = sessionInfo?.folderName || sessionId;

      // Create the expected thumbnail filename pattern
      // The cache key format is: {folderName}--{filename}
      const thumbnailPattern = `--${filename}`;

      // Update the sessions list with the new shot count and thumbnails
      setSessions(prev => prev.map(s =>
        s.id === sessionId
          ? {
              ...s,
              shotCount: updatedSession.shotCount,
              lastUsedAt: updatedSession.lastUsedAt,
              // Remove the deleted thumbnail (match by filename in the cached thumbnail path)
              thumbnails: s.thumbnails.filter(t => !t.endsWith(thumbnailPattern))
            }
          : s
      ));

      // If the deleted photo was in the current session, update that too
      if (currentSession?.id === sessionId) {
        setCurrentSession(prev => prev ? {
          ...prev,
          shotCount: updatedSession.shotCount,
          lastUsedAt: updatedSession.lastUsedAt,
          photos: updatedSession.photos,
          googleDriveMetadata: updatedSession.googleDriveMetadata || { uploadedImages: [] },
        } : null);
      }

      showToast(
        'Photo Deleted',
        'success',
        3000,
        `Deleted "${filename}"`
      );
    } catch (error) {
      logger.error('Failed to delete photo:', error);
      showToast(
        'Failed to Delete Photo',
        'error',
        5000,
        error instanceof Error ? error.message : 'Unknown error occurred'
      );
      throw error;
    }
  }, [workingFolder, currentSession, showToast, sessions]);

  // Refresh sessions when working folder changes
  useEffect(() => {
    if (workingFolder) {
      refreshSessions();
    }
  }, [workingFolder, refreshSessions]);

  // Set last generated GIF
  const setLastGif = useCallback((gif: { filePath: string; fileName: string; fileSize: number; photoCount: number }) => {
    setLastGeneratedMedia(prev => ({
      ...prev,
      gif: {
        ...gif,
        generatedAt: new Date().toISOString(),
      },
      video: prev?.video,
    }));
  }, []);

  // Set last generated video
  const setLastVideo = useCallback((video: { filePath: string; fileName: string; fileSize: number; photoCount: number }) => {
    setLastGeneratedMedia(prev => ({
      gif: prev?.gif,
      video: {
        ...video,
        generatedAt: new Date().toISOString(),
      },
    }));
  }, []);

  // Clear all last generated media
  const clearLastGenerated = useCallback(() => {
    setLastGeneratedMedia(null);
  }, []);

  return (
    <PhotoboothSessionContext.Provider
      value={{
        currentSession,
        sessions,
        refreshSessions,
        createNewSession,
        deleteSession,
        loadSession,
        setCurrentSession: setCurrentSessionId,
        updateSessionShotCount,
        updateCurrentSessionFromDownload,
        isLoadingSessions,
        updateSessionDriveFolder,
        addDriveUploadToSession,
        checkImageUploadedToDrive,
        clearDriveUploadsForSession,
        createDriveFolderForSession,
        deleteDriveFolderForSession,
        deleteSessionPhoto,
        lastGeneratedMedia,
        setLastGif,
        setLastVideo,
        clearLastGenerated,
      }}
    >
      {children}
    </PhotoboothSessionContext.Provider>
  );
}

export function usePhotoboothSession() {
  const context = useContext(PhotoboothSessionContext);
  if (!context) {
    throw new Error('usePhotoboothSession must be used within PhotoboothSessionProvider');
  }
  return context;
}

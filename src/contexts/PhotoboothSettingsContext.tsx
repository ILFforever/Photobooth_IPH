import { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from "react";
import { invoke } from '@tauri-apps/api/core';
import { useToast } from './ToastContext';
import * as sessionDrive from '../utils/sessionDrive';
import { useAuth } from './AuthContext';

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

interface PhotoboothSettingsContextType {
  autoCount: number;
  setAutoCount: (value: number) => void;
  timerDelay: number;
  setTimerDelay: (value: number) => void;
  delayBetweenPhotos: number;
  setDelayBetweenPhotos: (value: number) => void;
  photoReviewTime: number;
  setPhotoReviewTime: (value: number) => void;
  workingFolder: string | null;
  setWorkingFolder: (folder: string | null) => void;
  photoNamingScheme: string;
  setPhotoNamingScheme: (scheme: string) => void;
  qrUploadEnabled: boolean;
  setQrUploadEnabled: (value: boolean) => void;
  qrUploadAllImages: boolean;
  setQrUploadAllImages: (value: boolean) => void;
  // Auto GIF settings
  autoGifEnabled: boolean;
  setAutoGifEnabled: (value: boolean) => void;
  autoGifFormat: 'gif' | 'both' | 'video';
  setAutoGifFormat: (value: 'gif' | 'both' | 'video') => void;
  autoGifPhotoSource: 'collage' | 'all';
  setAutoGifPhotoSource: (value: 'collage' | 'all') => void;
  // Delay settings loaded from .ptb
  delaySettingsLoaded: boolean;
  // Session management
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

const PhotoboothSettingsContext = createContext<PhotoboothSettingsContextType | undefined>(undefined);

export function PhotoboothSettingsProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
  const { account, rootFolder } = useAuth();
  const [autoCount, setAutoCount] = useState(3);
  const [timerDelay, setTimerDelay] = useState(3);
  const [delayBetweenPhotos, setDelayBetweenPhotos] = useState(3);
  const [photoReviewTime, setPhotoReviewTime] = useState(3);
  const [workingFolder, setWorkingFolder] = useState<string | null>(null);
  const [photoNamingScheme, setPhotoNamingScheme] = useState('IPH_{number}');
  const [qrUploadEnabled, setQrUploadEnabled] = useState(true);
  const [qrUploadAllImages, setQrUploadAllImages] = useState(false);
  // Auto GIF settings
  const [autoGifEnabled, setAutoGifEnabled] = useState(false);
  const [autoGifFormat, setAutoGifFormat] = useState<'gif' | 'both' | 'video'>('both');
  const [autoGifPhotoSource, setAutoGifPhotoSource] = useState<'collage' | 'all'>('collage');
  const [delaySettingsLoaded, setDelaySettingsLoaded] = useState(false);

  // Session management state
  const [currentSession, setCurrentSession] = useState<PhotoboothSession | null>(null);
  const [sessions, setSessions] = useState<PhotoboothSessionInfo[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  // Last generated media state
  const [lastGeneratedMedia, setLastGeneratedMedia] = useState<LastGeneratedMedia | null>(null);

  // Track last folder to detect when folder changes
  const lastFolderRef = useRef<string | null>(null);

  // Save delay settings to .ptb file when they change
  useEffect(() => {
    if (workingFolder && delaySettingsLoaded) {
      const saveDelaySettings = async () => {
        try {
          await invoke('save_delay_settings', {
            folderPath: workingFolder,
            delaySettings: {
              autoCount,
              timerDelay,
              delayBetweenPhotos,
              photoReviewTime,
            },
          });
        } catch (error) {
          logger.error('Failed to save delay settings:', error);
        }
      };
      saveDelaySettings();
    }
  }, [autoCount, timerDelay, delayBetweenPhotos, photoReviewTime, workingFolder, delaySettingsLoaded]);

  // Save photobooth settings (QR upload, photo naming) to .ptb file when they change
  useEffect(() => {
    if (workingFolder && delaySettingsLoaded) {
      const savePhotoboothSettings = async () => {
        try {
          await invoke('save_photobooth_settings', {
            folderPath: workingFolder,
            photoboothSettings: {
              qrUploadEnabled,
              qrUploadAllImages,
              photoNamingScheme,
            },
          });
        } catch (error) {
          logger.error('Failed to save photobooth settings:', error);
        }
      };
      savePhotoboothSettings();
    }
  }, [qrUploadEnabled, qrUploadAllImages, photoNamingScheme, workingFolder, delaySettingsLoaded]);

  // Save GIF settings to .ptb file when they change
  useEffect(() => {
    if (workingFolder && delaySettingsLoaded) {
      const saveGifSettings = async () => {
        try {
          await invoke('save_gif_settings', {
            folderPath: workingFolder,
            gifSettings: {
              autoGifEnabled,
              autoGifFormat,
              autoGifPhotoSource,
            },
          });
        } catch (error) {
          logger.error('Failed to save GIF settings:', error);
        }
      };
      saveGifSettings();
    }
  }, [autoGifEnabled, autoGifFormat, autoGifPhotoSource, workingFolder, delaySettingsLoaded]);

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

      // Load workspace to get delay settings
      const workspace = await invoke<any>('load_ptb_workspace', {
        folderPath: workingFolder,
      });

      // Load delay settings if they exist in the workspace
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

        // Show toast when settings are loaded from .ptb file
        if (lastFolderRef.current !== workingFolder) {
          showToast(
            'Settings Applied',
            'info',
            4000,
            `Loaded: ${newSettings.autoCount} photos, ${newSettings.timerDelay}s start, ${newSettings.delayBetweenPhotos}s between, ${newSettings.photoReviewTime}s review`
          );
        }
      } else {
        // No delay settings in workspace, set defaults
        setDelaySettingsLoaded(false);
      }

      // Load photobooth settings (QR upload, photo naming) from workspace
      if (workspace.photoboothSettings) {
        const { qrUploadEnabled, qrUploadAllImages, photoNamingScheme } = workspace.photoboothSettings;
        setQrUploadEnabled(qrUploadEnabled ?? true);
        setQrUploadAllImages(qrUploadAllImages ?? false);
        setPhotoNamingScheme(photoNamingScheme ?? 'IPH_{number}');
      }

      // Load GIF settings from workspace
      if (workspace.gifSettings) {
        const { autoGifEnabled, autoGifFormat, autoGifPhotoSource } = workspace.gifSettings;
        setAutoGifEnabled(autoGifEnabled ?? false);
        setAutoGifFormat(autoGifFormat ?? 'both');
        setAutoGifPhotoSource(autoGifPhotoSource ?? 'collage');
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

      // Show toast based on whether ptb was created or loaded
      if (ptbCreated) {
        showToast('New workspace created', 'success', 3000, 'Ready to start capturing photos');
      } else {
        // Only show "loaded" toast if folder actually changed and we haven't shown settings toast
        if (lastFolderRef.current !== workingFolder && !workspace.delaySettings) {
          const sessionCount = sessionList.length;
          showToast(`${sessionCount} session${sessionCount !== 1 ? 's' : ''} loaded`, 'info', 3000);
        }
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
        const { deleteDriveFolder } = await import('../utils/driveFolder');
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
    <PhotoboothSettingsContext.Provider
      value={{
        autoCount,
        setAutoCount,
        timerDelay,
        setTimerDelay,
        delayBetweenPhotos,
        setDelayBetweenPhotos,
        photoReviewTime,
        setPhotoReviewTime,
        workingFolder,
        setWorkingFolder,
        photoNamingScheme,
        setPhotoNamingScheme,
        qrUploadEnabled,
        setQrUploadEnabled,
        qrUploadAllImages,
        setQrUploadAllImages,
        autoGifEnabled,
        setAutoGifEnabled,
        autoGifFormat,
        setAutoGifFormat,
        autoGifPhotoSource,
        setAutoGifPhotoSource,
        delaySettingsLoaded,
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
    </PhotoboothSettingsContext.Provider>
  );
}

export function usePhotoboothSettings() {
  const context = useContext(PhotoboothSettingsContext);
  if (!context) {
    throw new Error('usePhotoboothSettings must be used within PhotoboothSettingsProvider');
  }
  return context;
}

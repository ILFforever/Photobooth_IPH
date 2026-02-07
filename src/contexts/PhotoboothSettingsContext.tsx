import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { invoke } from '@tauri-apps/api/core';

// Session info structure matching the backend
export interface PhotoboothSessionInfo {
  id: string;
  name: string;
  folderName: string;
  shotCount: number;
  createdAt: string;
  lastUsedAt: string;
  thumbnails: string[]; // Thumbnail URLs for the session's photos
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
  // Session management
  currentSession: PhotoboothSession | null;
  sessions: PhotoboothSessionInfo[];
  refreshSessions: () => Promise<void>;
  createNewSession: (name: string) => Promise<PhotoboothSessionInfo>;
  loadSession: (sessionId: string) => Promise<void>;
  setCurrentSession: (sessionId: string) => Promise<void>;
  updateSessionShotCount: (sessionId: string, shotCount: number) => void;
  updateCurrentSessionFromDownload: (ptbSession: PhotoboothSession) => void;
  isLoadingSessions: boolean;
}

const PhotoboothSettingsContext = createContext<PhotoboothSettingsContextType | undefined>(undefined);

export function PhotoboothSettingsProvider({ children }: { children: ReactNode }) {
  const [autoCount, setAutoCount] = useState(3);
  const [timerDelay, setTimerDelay] = useState(5);
  const [delayBetweenPhotos, setDelayBetweenPhotos] = useState(2);
  const [photoReviewTime, setPhotoReviewTime] = useState(3);
  const [workingFolder, setWorkingFolder] = useState<string | null>(null);

  // Session management state
  const [currentSession, setCurrentSession] = useState<PhotoboothSession | null>(null);
  const [sessions, setSessions] = useState<PhotoboothSessionInfo[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  // Refresh the list of sessions
  const refreshSessions = useCallback(async () => {
    if (!workingFolder) return;

    try {
      setIsLoadingSessions(true);
      const sessionList = await invoke<PhotoboothSessionInfo[]>('list_photobooth_sessions', {
        folderPath: workingFolder,
      });
      setSessions(sessionList);

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
        });
      }
    } catch (error) {
      console.error('Failed to refresh sessions:', error);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [workingFolder]);

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
    return sessionInfo;
  }, [workingFolder, refreshSessions]);

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
      });

      // Also set as current session in workspace
      await invoke('set_current_session', {
        folderPath: workingFolder,
        sessionId,
      });
    } catch (error) {
      console.error('Failed to load session:', error);
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
  const updateCurrentSessionFromDownload = useCallback((ptbSession: PhotoboothSession) => {
    setCurrentSession(ptbSession);
    setSessions(prev => prev.map(s =>
      s.id === ptbSession.id
        ? { ...s, shotCount: ptbSession.shotCount, lastUsedAt: ptbSession.lastUsedAt }
        : s
    ));
  }, []);

  // Refresh sessions when working folder changes
  useEffect(() => {
    if (workingFolder) {
      refreshSessions();
    }
  }, [workingFolder, refreshSessions]);

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
        currentSession,
        sessions,
        refreshSessions,
        createNewSession,
        loadSession,
        setCurrentSession: setCurrentSessionId,
        updateSessionShotCount,
        updateCurrentSessionFromDownload,
        isLoadingSessions,
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

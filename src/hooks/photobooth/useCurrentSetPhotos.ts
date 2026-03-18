import { useState, useEffect, useRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { imageCache } from '../../services/ImageCacheService';
import type { CurrentSetPhoto } from '../../components/PhotoboothView/photoboothWorkspaceTypes';
import type { PhotoboothSession, PhotoboothSessionInfo } from '../../contexts/photobooth/PhotoboothSettingsContext';
import { createLogger } from '../../utils/logger';

const logger = createLogger('PhotoboothWorkspace');

interface UseCurrentSetPhotosParams {
  photosTaken: number;
  currentSession: PhotoboothSession | null;
  workingFolder: string | null;
  sessions: PhotoboothSessionInfo[];
}

export function useCurrentSetPhotos({
  photosTaken,
  currentSession,
  workingFolder,
  sessions,
}: UseCurrentSetPhotosParams) {
  const [currentSetPhotos, setCurrentSetPhotos] = useState<CurrentSetPhoto[]>([]);
  const lastPhotosTakenRef = useRef(0);
  const lastSessionIdRef = useRef<string | null>(null);
  const lastWorkingFolderRef = useRef<string | null>(null);
  const lastPhotoCountRef = useRef<number>(0);

  // Add photos to set when photosTaken changes (happens during capture phase)
  useEffect(() => {
    if (photosTaken > lastPhotosTakenRef.current) {
      const newPhoto: CurrentSetPhoto = {
        id: `photo-${Date.now()}`,
        thumbnailUrl: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect fill="%23333" width="300" height="200"/><text x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%23666" font-family="monospace" font-size="24">Photo ${photosTaken}</text></svg>`)}`,
        timestamp: new Date().toLocaleTimeString(),
      };
      setCurrentSetPhotos(prev => [...prev, newPhoto]);
    }
    lastPhotosTakenRef.current = photosTaken;
  }, [photosTaken]);

  // Populate current set photos when loading an existing session
  useEffect(() => {
    // Populate when session changes, when working folder changes, or when photo count changes
    const sessionChanged = currentSession && currentSession.id !== lastSessionIdRef.current;
    const folderChanged = workingFolder && workingFolder !== lastWorkingFolderRef.current;
    const photoCountChanged = currentSession && currentSession.photos.length !== lastPhotoCountRef.current;

    if (currentSession && (sessionChanged || folderChanged || photoCountChanged)) {
      if (sessionChanged) {
        lastSessionIdRef.current = currentSession.id;
      }
      if (workingFolder) {
        lastWorkingFolderRef.current = workingFolder;
      }
      lastPhotoCountRef.current = currentSession.photos.length;

      if (currentSession.photos && currentSession.photos.length > 0) {
        // Get the session folder name
        const sessionInfo = sessions.find(s => s.id === currentSession.id);
        const folderName = sessionInfo?.folderName || currentSession.id;

        // Convert session photos to current set photos
        // Note: Using full-res images directly instead of cached thumbnails to avoid cache collision issues
        // TODO: Implement proper thumbnail system with unique cache keys and sessions array refresh
        const loadedPhotos: CurrentSetPhoto[] = currentSession.photos.map((photo, idx) => {
          let fullUrl: string | undefined;
          if (workingFolder) {
            const filePath = `${workingFolder}/${folderName}/${photo.filename}`;
            fullUrl = convertFileSrc(filePath);
          }

          return {
            id: photo.filename || `photo-${idx}`,
            thumbnailUrl: fullUrl || '',
            fullUrl,
            timestamp: new Date(photo.capturedAt).toLocaleTimeString(),
          };
        });

        setCurrentSetPhotos(loadedPhotos);

        // Preload all images in background for better performance
        const imageUrls = loadedPhotos.map(p => p.thumbnailUrl).filter(Boolean);
        imageCache.preloadImages(imageUrls, 8).catch(err => {
          logger.warn('[PhotoboothWorkspace] Some images failed to preload:', err);
        });
      } else {
        // Clear if new session has no photos
        setCurrentSetPhotos([]);
      }
    }
  }, [currentSession, workingFolder, sessions]);

  return {
    currentSetPhotos,
    setCurrentSetPhotos,
  };
}

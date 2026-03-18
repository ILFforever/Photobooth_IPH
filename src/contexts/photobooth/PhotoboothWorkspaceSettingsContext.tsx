import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { invoke } from '@tauri-apps/api/core';
import { useCaptureTiming } from "./PhotoboothCaptureSettingsContext";
import { createLogger } from "../../utils/logger";

const logger = createLogger('PhotoboothWorkspaceSettingsContext');

export interface WorkspaceSettingsContextType {
  workingFolder: string | null;
  setWorkingFolder: (folder: string | null) => void;
  photoNamingScheme: string;
  setPhotoNamingScheme: (scheme: string) => void;
  qrUploadEnabled: boolean;
  setQrUploadEnabled: (value: boolean) => void;
  qrUploadAllImages: boolean;
  setQrUploadAllImages: (value: boolean) => void;
  autoGifEnabled: boolean;
  setAutoGifEnabled: (value: boolean) => void;
  autoGifFormat: 'gif' | 'both' | 'video';
  setAutoGifFormat: (value: 'gif' | 'both' | 'video') => void;
  autoGifPhotoSource: 'collage' | 'all';
  setAutoGifPhotoSource: (value: 'collage' | 'all') => void;
}

const WorkspaceSettingsContext = createContext<WorkspaceSettingsContextType | undefined>(undefined);

export function WorkspaceSettingsProvider({ children }: { children: ReactNode }) {
  const {
    autoCount, timerDelay, delayBetweenPhotos, photoReviewTime,
    delaySettingsLoaded,
  } = useCaptureTiming();

  const [workingFolder, setWorkingFolder] = useState<string | null>(null);
  const [photoNamingScheme, setPhotoNamingScheme] = useState('IPH_{number}');
  const [qrUploadEnabled, setQrUploadEnabled] = useState(true);
  const [qrUploadAllImages, setQrUploadAllImages] = useState(false);
  // Auto GIF settings
  const [autoGifEnabled, setAutoGifEnabled] = useState(false);
  const [autoGifFormat, setAutoGifFormat] = useState<'gif' | 'both' | 'video'>('both');
  const [autoGifPhotoSource, setAutoGifPhotoSource] = useState<'collage' | 'all'>('collage');

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

  return (
    <WorkspaceSettingsContext.Provider
      value={{
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
      }}
    >
      {children}
    </WorkspaceSettingsContext.Provider>
  );
}

export function useWorkspaceSettings() {
  const context = useContext(WorkspaceSettingsContext);
  if (!context) {
    throw new Error('useWorkspaceSettings must be used within WorkspaceSettingsProvider');
  }
  return context;
}

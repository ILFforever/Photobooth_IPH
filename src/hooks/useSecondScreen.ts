import { useState, useCallback, useRef } from 'react';
import { WebviewWindow, getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emit } from '@tauri-apps/api/event';

const GUEST_DISPLAY_LABEL = 'guest-display';

export function useSecondScreen() {
  const [isSecondScreenOpen, setIsSecondScreenOpen] = useState(false);
  const guestWindowRef = useRef<WebviewWindow | null>(null);

  const openSecondScreen = useCallback(async () => {
    try {
      // If we already have a reference, try to focus it
      if (guestWindowRef.current) {
        try {
          await guestWindowRef.current.setFocus();
          await guestWindowRef.current.unminimize();
          setIsSecondScreenOpen(true);
          return;
        } catch {
          // Window was closed, clear ref
          guestWindowRef.current = null;
        }
      }

      console.log('Creating guest display window...');

      // Create new window with same URL as main (index.html)
      // The main.tsx will detect the window label and render GuestDisplay
      const guestWindow = new WebviewWindow(GUEST_DISPLAY_LABEL, {
        url: 'index.html',
        width: 1280,
        height: 720,
        decorations: false,
        transparent: false,
        alwaysOnTop: false,
        resizable: true,
        center: false,
        skipTaskbar: false,
      });

      guestWindowRef.current = guestWindow;
      console.log('Guest display window created:', guestWindow.label);

      // Listen for window close
      guestWindow.onCloseRequested(() => {
        console.log('Guest display window closed');
        setIsSecondScreenOpen(false);
        guestWindowRef.current = null;
      });

      setIsSecondScreenOpen(true);
    } catch (error) {
      console.error('Failed to open second screen:', error);
    }
  }, []);

  const closeSecondScreen = useCallback(async () => {
    try {
      if (guestWindowRef.current) {
        await guestWindowRef.current.destroy();
        setIsSecondScreenOpen(false);
        guestWindowRef.current = null;
      }
    } catch (error) {
      console.error('Failed to close second screen:', error);
    }
  }, []);

  const updateGuestDisplay = useCallback((data: {
    currentSetPhotos?: Array<{ id: string; thumbnailUrl: string; timestamp: string }>;
    selectedPhotoIndex?: number | null;
    displayMode?: 'single' | 'center' | 'canvas';
  }) => {
    if (isSecondScreenOpen) {
      emit('guest-display:update', data);
    }
  }, [isSecondScreenOpen]);

  const updateDisplayMode = useCallback((mode: 'single' | 'center' | 'canvas') => {
    if (isSecondScreenOpen) {
      emit('guest-display:mode', mode);
    }
  }, [isSecondScreenOpen]);

  const selectPhoto = useCallback((index: number | null) => {
    if (isSecondScreenOpen) {
      emit('guest-display:select-photo', index);
    }
  }, [isSecondScreenOpen]);

  const addPhoto = useCallback((photo: { id: string; thumbnailUrl: string; timestamp: string }) => {
    if (isSecondScreenOpen) {
      emit('guest-display:add-photo', photo);
    }
  }, [isSecondScreenOpen]);

  return {
    isSecondScreenOpen,
    openSecondScreen,
    closeSecondScreen,
    updateGuestDisplay,
    updateDisplayMode,
    selectPhoto,
    addPhoto,
  };
}

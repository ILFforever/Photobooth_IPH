import { useState, useCallback, useRef } from 'react';
import { WebviewWindow, getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emitTo } from '@tauri-apps/api/event';

const GUEST_DISPLAY_LABEL = 'guest-display';

export function useSecondScreen() {
  const [isSecondScreenOpen, setIsSecondScreenOpen] = useState(false);
  const guestWindowRef = useRef<WebviewWindow | null>(null);

  const openSecondScreen = useCallback(async (initialData?: {
    currentSetPhotos: Array<{ id: string; thumbnailUrl: string; timestamp: string }>;
    selectedPhotoIndex: number | null;
    displayMode: 'single' | 'center' | 'canvas';
    centerBrowseIndex: number | null;
  }) => {
    try {
      // If we already have a reference, try to focus it
      if (guestWindowRef.current) {
        try {
          await guestWindowRef.current.setFocus();
          await guestWindowRef.current.unminimize();
          setIsSecondScreenOpen(true);
          // Sync current state even if window was already open
          if (initialData) {
            setTimeout(() => {
              emitTo(GUEST_DISPLAY_LABEL, 'guest-display:mode', initialData.displayMode);
              emitTo(GUEST_DISPLAY_LABEL, 'guest-display:update', {
                currentSetPhotos: initialData.currentSetPhotos,
                selectedPhotoIndex: initialData.selectedPhotoIndex,
              });
              emitTo(GUEST_DISPLAY_LABEL, 'guest-display:center-browse', initialData.centerBrowseIndex);
            }, 100);
          }
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

      // Send initial state after a delay to ensure the window is ready and listeners are set up
      if (initialData) {
        console.log('[useSecondScreen] Scheduling initial state send with', initialData.currentSetPhotos.length, 'photos');
        setTimeout(() => {
          console.log('[useSecondScreen] Sending initial state to guest display');
          emitTo(GUEST_DISPLAY_LABEL, 'guest-display:mode', initialData.displayMode);
          emitTo(GUEST_DISPLAY_LABEL, 'guest-display:update', {
            currentSetPhotos: initialData.currentSetPhotos,
            selectedPhotoIndex: initialData.selectedPhotoIndex,
          });
          emitTo(GUEST_DISPLAY_LABEL, 'guest-display:center-browse', initialData.centerBrowseIndex);
        }, 500);
      }
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
    liveViewStream?: boolean; // Indicates if live view stream is active
    hdmiStreamActive?: boolean; // Indicates if HDMI stream is active
    showCapturePreview?: boolean; // Show capture preview overlay
    capturedPhotoUrl?: string | null; // URL of the captured photo to show in preview
  }) => {
    if (isSecondScreenOpen) {
      console.log('[useSecondScreen] updateGuestDisplay called with:', data);
      emitTo(GUEST_DISPLAY_LABEL, 'guest-display:update', data);
    } else {
      console.log('[useSecondScreen] updateGuestDisplay called but second screen is not open');
    }
  }, [isSecondScreenOpen]);

  const updateDisplayMode = useCallback((mode: 'single' | 'center' | 'canvas') => {
    if (isSecondScreenOpen) {
      emitTo(GUEST_DISPLAY_LABEL, 'guest-display:mode', mode);
    }
  }, [isSecondScreenOpen]);

  const selectPhoto = useCallback((index: number | null) => {
    if (isSecondScreenOpen) {
      emitTo(GUEST_DISPLAY_LABEL, 'guest-display:select-photo', index);
    }
  }, [isSecondScreenOpen]);

  const addPhoto = useCallback((photo: { id: string; thumbnailUrl: string; timestamp: string }) => {
    if (isSecondScreenOpen) {
      emitTo(GUEST_DISPLAY_LABEL, 'guest-display:add-photo', photo);
    }
  }, [isSecondScreenOpen]);

  const selectCenterPhoto = useCallback((index: number | null) => {
    if (isSecondScreenOpen) {
      emitTo(GUEST_DISPLAY_LABEL, 'guest-display:center-browse', index);
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
    selectCenterPhoto,
  };
}

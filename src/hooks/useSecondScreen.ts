import { useState, useCallback, useRef } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emitTo } from '@tauri-apps/api/event';

const GUEST_DISPLAY_LABEL = 'guest-display';

export function useSecondScreen() {
  const [isSecondScreenOpen, setIsSecondScreenOpen] = useState(false);
  const guestWindowRef = useRef<WebviewWindow | null>(null);

  const openSecondScreen = useCallback(async (initialData?: {
    currentSetPhotos: Array<{ id: string; thumbnailUrl: string; fullUrl?: string; timestamp: string }>;
    selectedPhotoIndex: number | null;
    displayMode: 'single' | 'center' | 'canvas' | 'finalize';
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
            emitTo(GUEST_DISPLAY_LABEL, 'guest-display:mode', initialData.displayMode);
            emitTo(GUEST_DISPLAY_LABEL, 'guest-display:update', {
              currentSetPhotos: initialData.currentSetPhotos,
              selectedPhotoIndex: initialData.selectedPhotoIndex,
            });
            emitTo(GUEST_DISPLAY_LABEL, 'guest-display:center-browse', initialData.centerBrowseIndex);
          }
          return;
        } catch {
          // Window was closed, clear ref
          guestWindowRef.current = null;
        }
      }

      // Create new window with same URL as main (index.html)
      // The main.tsx will detect the window label and render GuestDisplay
      // Pass initial display mode via URL parameter for instant sync
      const initialMode = initialData?.displayMode || 'center';
      const guestWindow = new WebviewWindow(GUEST_DISPLAY_LABEL, {
        url: `index.html?mode=${initialMode}`,
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

      // Listen for window close
      guestWindow.onCloseRequested(() => {
        setIsSecondScreenOpen(false);
        guestWindowRef.current = null;
      });

      setIsSecondScreenOpen(true);

      // Initial data will be sent when the guest display emits 'guest-display:ready'
      // after its event listeners are set up (handled in PhotoboothWorkspace)
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
    currentSetPhotos?: Array<{ id: string; thumbnailUrl: string; fullUrl?: string; timestamp: string }>;
    selectedPhotoIndex?: number | null;
    displayMode?: 'single' | 'center' | 'canvas' | 'finalize';
    liveViewStream?: boolean;
    hdmiStreamActive?: boolean;
    showCapturePreview?: boolean;
    capturedPhotoUrl?: string | null;
    finalizeImageUrl?: string | null;
    finalizeQrData?: string | null;
  }) => {
    if (isSecondScreenOpen) {
      emitTo(GUEST_DISPLAY_LABEL, 'guest-display:update', data);
    }
  }, [isSecondScreenOpen]);

  const updateDisplayMode = useCallback((mode: 'single' | 'center' | 'canvas' | 'finalize') => {
    if (isSecondScreenOpen) {
      emitTo(GUEST_DISPLAY_LABEL, 'guest-display:mode', mode);
    }
  }, [isSecondScreenOpen]);

  const selectPhoto = useCallback((index: number | null) => {
    if (isSecondScreenOpen) {
      emitTo(GUEST_DISPLAY_LABEL, 'guest-display:select-photo', index);
    }
  }, [isSecondScreenOpen]);

  const addPhoto = useCallback((photo: { id: string; thumbnailUrl: string; fullUrl?: string; timestamp: string }) => {
    if (isSecondScreenOpen) {
      emitTo(GUEST_DISPLAY_LABEL, 'guest-display:add-photo', photo);
    }
  }, [isSecondScreenOpen]);

  const selectCenterPhoto = useCallback((index: number | null) => {
    if (isSecondScreenOpen) {
      emitTo(GUEST_DISPLAY_LABEL, 'guest-display:center-browse', index);
    }
  }, [isSecondScreenOpen]);

  const updateCountdown = useCallback((data: { active: boolean; value: number }) => {
    if (isSecondScreenOpen) {
      emitTo(GUEST_DISPLAY_LABEL, 'guest-display:countdown', data);
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
    updateCountdown,
  };
}

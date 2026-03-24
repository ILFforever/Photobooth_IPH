import { useEffect, useRef } from 'react';
import { listen, emitTo, type UnlistenFn } from '@tauri-apps/api/event';
import type { CurrentSetPhoto, DisplayMode } from '../../components/PhotoboothView/photoboothWorkspaceTypes';
import type { SequenceState } from './usePhotoboothSequence';
import { createLogger } from '../../utils/logger';

const logger = createLogger('PhotoboothWorkspace');

interface UseGuestDisplaySyncParams {
  secondScreen: {
    updateDisplayMode: (mode: 'single' | 'center' | 'canvas' | 'finalize') => void;
    selectPhoto: (index: number | null) => void;
    selectCenterPhoto: (index: number | null) => void;
    updateCountdown: (data: { active: boolean; value: number }) => void;
    updateGuestDisplay: (data: {
      currentSetPhotos?: CurrentSetPhoto[];
      selectedPhotoIndex?: number | null;
      displayMode?: DisplayMode;
      showCapturePreview?: boolean;
      capturedPhotoUrl?: string | null;
      finalizeImageUrl?: string | null;
      finalizeQrData?: string | null;
    }) => void;
  };
  displayMode: DisplayMode;
  selectedPhotoIndex: number | null;
  centerBrowseIndex: number | null;
  currentSetPhotos: CurrentSetPhoto[];
  sequence: {
    sequenceState: SequenceState;
    currentCountdown: number;
  };
  handleCapturePreviewLoad: () => void;
  setSelectedPhotoIndex: (index: number | null) => void;
}

export function useGuestDisplaySync({
  secondScreen,
  displayMode,
  selectedPhotoIndex,
  centerBrowseIndex,
  currentSetPhotos,
  sequence,
  handleCapturePreviewLoad,
  setSelectedPhotoIndex,
}: UseGuestDisplaySyncParams) {
  // Refs for guest-display:ready handler (avoids stale closures)
  const currentSetPhotosRef = useRef(currentSetPhotos);
  currentSetPhotosRef.current = currentSetPhotos;
  const selectedPhotoIndexRef = useRef(selectedPhotoIndex);
  selectedPhotoIndexRef.current = selectedPhotoIndex;
  const displayModeRef = useRef(displayMode);
  displayModeRef.current = displayMode;
  const centerBrowseIndexRef = useRef(centerBrowseIndex);
  centerBrowseIndexRef.current = centerBrowseIndex;

  // Sync display mode to guest display
  useEffect(() => {
    // Don't sync finalize mode - only FinalizeView should control that
    if (displayMode !== 'finalize') {
      secondScreen.updateDisplayMode(displayMode);
    }
  }, [displayMode, secondScreen.updateDisplayMode]);

  // Sync selected photo index to guest display
  useEffect(() => {
    secondScreen.selectPhoto(selectedPhotoIndex);
  }, [selectedPhotoIndex, secondScreen.selectPhoto]);

  // Sync center browse index to guest display
  useEffect(() => {
    secondScreen.selectCenterPhoto(centerBrowseIndex);
  }, [centerBrowseIndex, secondScreen.selectCenterPhoto]);

  // Sync photos to guest display when they change
  // Note: displayMode is synced separately via updateDisplayMode above
  useEffect(() => {
    secondScreen.updateGuestDisplay({
      currentSetPhotos,
      selectedPhotoIndex,
    });
  }, [currentSetPhotos, selectedPhotoIndex, secondScreen.updateGuestDisplay]);

  // Sync countdown state to guest display
  useEffect(() => {
    const isCountdownActive = sequence.sequenceState === 'countdown';
    secondScreen.updateCountdown({
      active: isCountdownActive,
      value: isCountdownActive ? sequence.currentCountdown : 0,
    });
  }, [sequence.sequenceState, sequence.currentCountdown, secondScreen.updateCountdown]);

  // Listen for events from guest display
  useEffect(() => {
    let cancelled = false;
    let unlisteners: UnlistenFn[] = [];

    const setupListeners = async () => {
      const listeners = await Promise.all([
        listen('guest-display:escape', () => {
          setSelectedPhotoIndex(null);
        }),
        listen('guest-display:select-photo', (event: { payload: number | null }) => {
          setSelectedPhotoIndex(event.payload);
        }),
        listen('guest-display:preview-loaded', () => {
          // Guest display has finished loading the preview image, start countdown
          logger.debug('[PhotoboothWorkspace] Guest display preview loaded');
          handleCapturePreviewLoad();
        }),
        listen('guest-display:ready', () => {
          // Guest display listeners are ready — send full current state
          logger.debug('[PhotoboothWorkspace] Guest display ready, sending full state');
          emitTo('guest-display', 'guest-display:mode', displayModeRef.current);
          emitTo('guest-display', 'guest-display:update', {
            currentSetPhotos: currentSetPhotosRef.current,
            selectedPhotoIndex: selectedPhotoIndexRef.current,
          });
          emitTo('guest-display', 'guest-display:center-browse', centerBrowseIndexRef.current);
        }),
      ]);

      if (cancelled) {
        // Cleanup already ran before async resolved — unlisten immediately
        listeners.forEach(u => u());
        return;
      }
      unlisteners = listeners;
    };

    setupListeners();

    return () => {
      cancelled = true;
      unlisteners.forEach(u => u());
    };
  }, [handleCapturePreviewLoad]);
}

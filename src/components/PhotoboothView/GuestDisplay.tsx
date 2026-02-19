import { useState, useEffect, useRef, useCallback } from "react";
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { emit } from '@tauri-apps/api/event';
import DisplayContent from "./DisplayContent";

export type { UnlistenFn };

// Event emitted when capture preview has finished loading in guest display
const CAPTURE_PREVIEW_LOADED_EVENT = 'guest-display:preview-loaded';

export type { UnlistenFn };

type DisplayMode = 'single' | 'center' | 'canvas' | 'finalize';

interface CurrentSetPhoto {
  id: string;
  thumbnailUrl: string;
  fullUrl?: string;
  timestamp: string;
}

interface PhotoState {
  currentSetPhotos: CurrentSetPhoto[];
  selectedPhotoIndex: number | null;
  displayMode: DisplayMode;
  showCapturePreview: boolean;
  capturedPhotoUrl: string | null;
  finalizeImageUrl: string | null;
  finalizeQrData: string | null;
}

function base64ToBlob(b64: string, mime: string): Blob {
  const byteChars = atob(b64);
  const byteArray = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteArray[i] = byteChars.charCodeAt(i);
  }
  return new Blob([byteArray], { type: mime });
}

export default function GuestDisplay() {
  // Initialize with window label's initial state from main window (if available)
  const [photoState, setPhotoState] = useState<PhotoState>({
    currentSetPhotos: [],
    selectedPhotoIndex: null,
    displayMode: 'center', // Will be overridden by main window's current mode
    showCapturePreview: false,
    capturedPhotoUrl: null,
    finalizeImageUrl: null,
    finalizeQrData: null,
  });

  // Center mode photo browsing
  const [centerBrowseIndex, setCenterBrowseIndex] = useState<number | null>(null);

  // Countdown overlay state
  const [countdown, setCountdown] = useState<{ active: boolean; value: number }>({ active: false, value: 0 });

  // Live stream frame handling - supports both HDMI and PTP streams
  const [liveStreamUrl, setLiveStreamUrl] = useState<string | null>(null);
  const prevUrlRef = useRef<string | null>(null);
  const hdmiFrameCountRef = useRef(0);
  const ptpFrameCountRef = useRef(0);

  // Capture preview timer - auto-switch back to live view after photoReviewTime
  const previewTimerRef = useRef<NodeJS.Timeout | null>(null);
  const capturedPhotoUrlRef = useRef<string | null>(null);

  // Clear any pending preview timer
  const clearPreviewTimer = useCallback(() => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  }, []);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      clearPreviewTimer();
    };
  }, [clearPreviewTimer]);

  // Read initial display mode from URL parameter on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const modeParam = urlParams.get('mode');
    if (modeParam && ['single', 'center', 'canvas', 'finalize'].includes(modeParam)) {
      setPhotoState(prev => ({ ...prev, displayMode: modeParam as DisplayMode }));
    }
  }, []);

  // Listen for HDMI frames
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupHdmiListener = async () => {
      unlisten = await listen<string>('hdmi-frame', (event) => {
        hdmiFrameCountRef.current++;
        if (hdmiFrameCountRef.current === 1) {
          console.log('[GuestDisplay] ✓ First HDMI frame received');
        }

        const blob = base64ToBlob(event.payload, 'image/jpeg');
        const url = URL.createObjectURL(blob);

        // Revoke previous URL to prevent memory leak
        if (prevUrlRef.current) {
          URL.revokeObjectURL(prevUrlRef.current);
        }
        prevUrlRef.current = url;

        setLiveStreamUrl(url);
      });
    };

    setupHdmiListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
      if (prevUrlRef.current) {
        URL.revokeObjectURL(prevUrlRef.current);
        prevUrlRef.current = null;
      }
    };
  }, []);

  // Listen for PTP frames (USB-C streaming)
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupPtpListener = async () => {
      unlisten = await listen<string>('ptp-frame', (event) => {
        ptpFrameCountRef.current++;
        if (ptpFrameCountRef.current === 1) {
          console.log('[GuestDisplay] ✓ First PTP frame received');
        }

        const blob = base64ToBlob(event.payload, 'image/jpeg');
        const url = URL.createObjectURL(blob);

        // Revoke previous URL to prevent memory leak
        if (prevUrlRef.current) {
          URL.revokeObjectURL(prevUrlRef.current);
        }
        prevUrlRef.current = url;

        setLiveStreamUrl(url);
      });
    };

    setupPtpListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
      // Note: prevUrlRef cleanup is shared with HDMI listener
    };
  }, []);

  // Listen for state updates from main window
  useEffect(() => {
    let unlisteners: UnlistenFn[] = [];

    // Setup all listeners
    const setupListeners = async () => {
      const [unlisten1, unlisten2, unlisten3, unlisten4, unlisten5] = await Promise.all([
        listen('guest-display:update', (event: { payload: Partial<PhotoState> }) => {
          const payload = event.payload;
          setPhotoState(prev => {
            const newState = { ...prev, ...payload };

            // Handle capture preview trigger
            if (payload.showCapturePreview === true && payload.capturedPhotoUrl) {
              console.log('[GuestDisplay] Setting capture preview with URL:', payload.capturedPhotoUrl);
              capturedPhotoUrlRef.current = payload.capturedPhotoUrl;
              clearPreviewTimer();
            } else if (payload.showCapturePreview === false) {
              console.log('[GuestDisplay] Clearing capture preview');
              // Explicitly clearing preview
              clearPreviewTimer();
              capturedPhotoUrlRef.current = null;
            }

            return newState;
          });
        }),
        listen('guest-display:mode', (event: { payload: DisplayMode }) => {
          setPhotoState(prev => ({ ...prev, displayMode: event.payload }));
        }),
        listen('guest-display:select-photo', (event: { payload: number | null }) => {
          setPhotoState(prev => ({ ...prev, selectedPhotoIndex: event.payload }));
        }),
        listen('guest-display:add-photo', (event: { payload: CurrentSetPhoto }) => {
          setPhotoState(prev => ({ ...prev, currentSetPhotos: [...prev.currentSetPhotos, event.payload] }));
        }),
        listen('guest-display:center-browse', (event: { payload: number | null }) => {
          setCenterBrowseIndex(event.payload);
        }),
      ]);
      unlisteners = [unlisten1, unlisten2, unlisten3, unlisten4, unlisten5];
    };

    setupListeners();

    return () => {
      unlisteners.forEach(u => u());
    };
  }, []);

  const { currentSetPhotos, selectedPhotoIndex, displayMode, showCapturePreview, capturedPhotoUrl, finalizeImageUrl, finalizeQrData } = photoState;

  // Handle keyboard navigation for fullscreen mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC to exit fullscreen - notify main window
      if (e.key === 'Escape' && selectedPhotoIndex !== null && displayMode === 'canvas') {
        emit('guest-display:escape');
      }

      // Arrow key navigation in fullscreen mode
      if (selectedPhotoIndex !== null && displayMode === 'canvas') {
        const photoCount = currentSetPhotos.length || 6;
        let newIndex = selectedPhotoIndex;

        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          newIndex = Math.max(0, selectedPhotoIndex - 1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          newIndex = Math.min(photoCount - 1, selectedPhotoIndex + 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          newIndex = Math.max(0, selectedPhotoIndex - 3);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          newIndex = Math.min(photoCount - 1, selectedPhotoIndex + 3);
        }

        if (newIndex !== selectedPhotoIndex) {
          emit('guest-display:select-photo', newIndex);
          setPhotoState(prev => ({ ...prev, selectedPhotoIndex: newIndex }));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPhotoIndex, displayMode, currentSetPhotos.length]);

  // Handle double-click on photo to enter fullscreen
  const handlePhotoDoubleClick = (index: number) => {
    setPhotoState(prev => ({ ...prev, selectedPhotoIndex: index }));
    emit('guest-display:select-photo', index);
  };

  // Handle double-click to exit fullscreen
  const handleExitFullscreen = () => {
    setPhotoState(prev => ({ ...prev, selectedPhotoIndex: null }));
    emit('guest-display:escape');
  };

  // Handle arrow navigation clicks
  const handleNavClick = (direction: 'prev' | 'next') => {
    if (selectedPhotoIndex === null) return;

    const totalPhotos = currentSetPhotos.length || 6;
    const newIndex = direction === 'prev'
      ? Math.max(0, selectedPhotoIndex - 1)
      : Math.min(totalPhotos - 1, selectedPhotoIndex + 1);

    setPhotoState(prev => ({ ...prev, selectedPhotoIndex: newIndex }));
    emit('guest-display:select-photo', newIndex);
  };

  // Called when capture preview image has finished loading
  const handleCapturePreviewLoad = useCallback(() => {
    console.log('[GuestDisplay] Capture preview image loaded, notifying main window');
    emit(CAPTURE_PREVIEW_LOADED_EVENT);
  }, []);

  return (
    <div className="guest-display">
      {/* Drag handle for moving the window */}
      <div data-tauri-drag-region className="guest-display-drag-handle" />
      <div className="preview-frame">
        <div className="preview-content">
          <DisplayContent
            displayMode={displayMode}
            currentSetPhotos={currentSetPhotos}
            selectedPhotoIndex={selectedPhotoIndex}
            onPhotoDoubleClick={handlePhotoDoubleClick}
            onExitFullscreen={handleExitFullscreen}
            onNavClick={handleNavClick}
            hdmiStreamUrl={liveStreamUrl}
            showRecentPhotos={displayMode === 'center'}
            showCapturePreview={showCapturePreview}
            capturedPhotoUrl={capturedPhotoUrl}
            onCapturePreviewLoad={handleCapturePreviewLoad}
            finalizeImageUrl={finalizeImageUrl}
            finalizeQrData={finalizeQrData}
            centerBrowseIndex={centerBrowseIndex}
            onCenterPhotoClick={(index) => setCenterBrowseIndex(index)}
            onCenterBack={() => setCenterBrowseIndex(null)}
            onCenterNavClick={(direction) => {
              setCenterBrowseIndex(prev => {
                if (prev === null) return null;
                const total = currentSetPhotos.length;
                if (direction === 'prev') return Math.max(0, prev - 1);
     
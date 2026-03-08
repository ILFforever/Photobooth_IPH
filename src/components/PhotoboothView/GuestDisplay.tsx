import { useState, useEffect, useRef, useCallback } from "react";
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { emit } from '@tauri-apps/api/event';
import DisplayContent from "./DisplayContent";
import { createLogger } from '../../utils/logger';

const logger = createLogger('GuestDisplay');

export type { UnlistenFn };

// Event emitted when capture preview has finished loading in guest display
const CAPTURE_PREVIEW_LOADED_EVENT = 'guest-display:preview-loaded';

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

// Helper function to convert base64 string to Blob (used by HDMI)
function base64ToBlob(b64: string, mime: string): Blob {
  const byteChars = atob(b64);
  const byteArray = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteArray[i] = byteChars.charCodeAt(i);
  }
  return new Blob([byteArray], { type: mime });
}

// arrayToBlob removed — PTP now uses base64 (same as HDMI) via 'ptp-frame-b64' event

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

  // Ref tracks whether the current display mode shows the live view.
  // Used inside event listeners to skip expensive blob creation + state
  // updates when the live view isn't visible (canvas / finalize modes).
  const showsLiveViewRef = useRef(true);

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

  // Listen for video settings (stretch/rotation) from main window
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      unlisten = await listen<{ stretch: number; stretchV: number; rotation: number }>(
        'guest-display:video-settings',
        (event) => {
          const { stretch, stretchV, rotation } = event.payload;
          document.documentElement.style.setProperty('--video-stretch', stretch.toString());
          document.documentElement.style.setProperty('--video-stretch-v', stretchV.toString());
          document.documentElement.style.setProperty('--video-rotate', `${rotation}deg`);
        }
      );
    };

    setup();
    return () => { if (unlisten) unlisten(); };
  }, []);

  // Listen for HDMI frames
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupHdmiListener = async () => {
      unlisten = await listen<string>('hdmi-frame', (event) => {
        hdmiFrameCountRef.current++;

        // Skip expensive blob creation + state update when live view isn't visible
        if (!showsLiveViewRef.current) return;

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
      unlisten = await listen<string>('ptp-frame-b64', (event) => {
        ptpFrameCountRef.current++;

        // Skip expensive blob creation + state update when live view isn't visible
        if (!showsLiveViewRef.current) return;

        // Same path as HDMI — base64 → blob → objectURL
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
      const [unlisten1, unlisten2, unlisten3, unlisten4, unlisten5, unlisten6] = await Promise.all([
        listen('guest-display:update', (event: { payload: Partial<PhotoState> }) => {
          const payload = event.payload;
          setPhotoState(prev => {
            const newState = { ...prev, ...payload };

            // Handle capture preview trigger
            if (payload.showCapturePreview === true && payload.capturedPhotoUrl) {
              logger.debug('[GuestDisplay] Setting capture preview with URL:', payload.capturedPhotoUrl);
              capturedPhotoUrlRef.current = payload.capturedPhotoUrl;
              clearPreviewTimer();
            } else if (payload.showCapturePreview === false) {
              logger.debug('[GuestDisplay] Clearing capture preview');
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
        listen('guest-display:countdown', (event: { payload: { active: boolean; value: number } }) => {
          setCountdown(event.payload);
        }),
      ]);
      unlisteners = [unlisten1, unlisten2, unlisten3, unlisten4, unlisten5, unlisten6];
    };

    setupListeners().then(() => {
      // Notify main window that we're ready to receive state
      logger.debug('[GuestDisplay] Listeners ready, requesting initial state');
      emit('guest-display:ready');
    });

    return () => {
      unlisteners.forEach(u => u());
    };
  }, []);

  const { currentSetPhotos, selectedPhotoIndex, displayMode, showCapturePreview, capturedPhotoUrl, finalizeImageUrl, finalizeQrData } = photoState;

  // Keep ref in sync so frame listeners can check without re-subscribing
  showsLiveViewRef.current = displayMode === 'single' || displayMode === 'center';

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
    logger.debug('[GuestDisplay] Capture preview image loaded, notifying main window');
    emit(CAPTURE_PREVIEW_LOADED_EVENT);
  }, []);

  // Show countdown overlay on single and center modes when countdown is active
  const showCountdownOverlay = countdown.active && (displayMode === 'single' || displayMode === 'center');

  return (
    <div className="guest-display">
      {/* Drag handle for moving the window */}
      <div data-tauri-drag-region className="guest-display-drag-handle" />
      <div className="preview-frame">
        <div className="preview-content">
          {showCountdownOverlay && (
            <div className="countdown-overlay">
              <div className="countdown-look-up">
                <svg className="countdown-arrow" viewBox="0 0 40 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2 14 20 2 38 14" />
                </svg>
                <span>Look up at the camera</span>
              </div>
              <div className="countdown-circle">
                <svg className="countdown-leader-svg" viewBox="0 0 100 100">
                  {/* Outer ring */}
                  <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.2" />
                  {/* Middle ring */}
                  <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
                  {/* Inner ring */}
                  <circle cx="50" cy="50" r="28" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="0.6" />
                  {/* Crosshairs */}
                  <line x1="50" y1="2" x2="50" y2="98" stroke="rgba(255,255,255,0.45)" strokeWidth="0.6" />
                  <line x1="2" y1="50" x2="98" y2="50" stroke="rgba(255,255,255,0.45)" strokeWidth="0.6" />
                  {/* Sweeping hand */}
                  <line className="countdown-hand" x1="50" y1="50" x2="50" y2="3" />
                </svg>
                <span className="countdown-number">{countdown.value}</span>
              </div>
            </div>
          )}
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
                return Math.min(total - 1, prev + 1);
              });
            }}
          />
        </div>
      </div>
    </div>
  );
}

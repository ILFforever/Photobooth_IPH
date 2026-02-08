import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Image as ImageIcon, ExternalLink, Camera, Grid3x3, Layers, AlertTriangle, X
} from "lucide-react";
import { usePhotoboothSettings, type PhotoboothSessionInfo, type SessionPhoto } from "../../contexts/PhotoboothSettingsContext";
import { usePhotoboothSequence } from "../../hooks/usePhotoboothSequence";
import { useCamera } from "../../contexts/CameraContext";
import { useLiveView } from "../../contexts/LiveViewContext";
import { useCollage } from "../../contexts/CollageContext";
import { PhotoboothControls } from "./PhotoboothControls";
import DisplayContent from "./DisplayContent";
import CurrentSetPhotoStrip from "./CurrentSetPhotoStrip";
import PhotoSessionsSidebar from "./PhotoSessionsSidebar";
import { type PhotoDownloadedEvent } from "../../services/cameraWebSocket";
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSecondScreen } from "../../hooks/useSecondScreen";
import "./PhotoboothWorkspace.css";

const DAEMON_URL = 'http://localhost:58321';

// Display mode presets - arranged like Lightroom modules
type DisplayMode = 'single' | 'center' | 'canvas';

interface DisplayPreset {
  id: DisplayMode;
  name: string;
  icon: React.ComponentType<{ size?: number }>;
  description: string;
}

const displayPresets: DisplayPreset[] = [
  { id: 'single', name: 'Single', icon: Layers, description: 'Single photo view' },
  { id: 'center', name: 'Center', icon: Camera, description: 'Centerstage with recent photos' },
  { id: 'canvas', name: 'Canvas', icon: Grid3x3, description: 'Grid showing all photos' },
];

// Mock data for current set photos (photos taken in the active session)
interface CurrentSetPhoto {
  id: string;
  thumbnailUrl: string;
  timestamp: string;
}



// PtbSession type matching Rust struct
interface PtbSession {
  name: string;
  createdAt: string;
  lastUsedAt: string;
  shotCount: number;
  photos: Array<{
    filename: string;
    originalPath: string;
    cameraPath: string;
    capturedAt: string;
  }>;
}

export default function PhotoboothWorkspace() {
  const {
    timerDelay,
    autoCount,
    delayBetweenPhotos,
    setDelayBetweenPhotos,
    photoReviewTime,
    workingFolder,
    sessions,
    currentSession,
    loadSession,
    updateCurrentSessionFromDownload
  } = usePhotoboothSettings();
  const { captureError, clearCaptureError, isCameraConnected, hasEverConnected, isConnecting, addPhotoDownloadedListener, removePhotoDownloadedListener } = useCamera();
  const { stream: liveViewStream, hdmi } = useLiveView();
  const { currentFrame } = useCollage();

  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set());
  const [displayMode, setDisplayMode] = useState<DisplayMode>('center');
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [currentSetPhotos, setCurrentSetPhotos] = useState<CurrentSetPhoto[]>([]);

  // Workflow state
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const frameZoneCount = 3; // TODO: Get from selected custom set

  // Working folder warning state
  const [showWorkingFolderWarning, setShowWorkingFolderWarning] = useState(false);
  // No camera warning state
  const [showNoCameraWarning, setShowNoCameraWarning] = useState(false);
  const [ptbSession, setPtbSession] = useState<PtbSession | null>(null);

  // Auto-load latest session when working folder changes
  useEffect(() => {
    const loadLatestSession = async () => {
      if (!workingFolder || sessions.length === 0) return;

      // If no current session and we haven't auto-loaded yet for this folder
      if (!currentSession && sessions.length > 0 && !hasAutoLoadedRef.current) {
        const latestSession = [...sessions].sort((a, b) =>
          new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
        )[0];

        console.log('[PhotoboothWorkspace] Auto-loading latest session:', latestSession.id);
        hasAutoLoadedRef.current = true;
        await loadSession(latestSession.id);
      }
    };

    loadLatestSession();
  }, [workingFolder, sessions, currentSession, loadSession]);

  // Reset auto-load flag when working folder changes
  useEffect(() => {
    hasAutoLoadedRef.current = false;
  }, [workingFolder]);

  // Second screen hook
  const { isSecondScreenOpen, openSecondScreen, closeSecondScreen, updateGuestDisplay, updateDisplayMode, selectPhoto } = useSecondScreen();

  // Photobooth sequence hook - manages all timing state
  const sequence = usePhotoboothSequence({
    delayBeforeFirstPhoto: timerDelay,
    delayBetweenPhotos,
    photoReviewTime,
    autoCount,
  });

  // Add photos to set when photosTaken changes (happens during capture phase)
  const lastPhotosTakenRef = useRef(0);
  const hasAutoLoadedRef = useRef(false);
  useEffect(() => {
    if (sequence.photosTaken > lastPhotosTakenRef.current) {
      const newPhoto: CurrentSetPhoto = {
        id: `photo-${Date.now()}`,
        thumbnailUrl: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect fill="%23333" width="300" height="200"/><text x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%23666" font-family="monospace" font-size="24">Photo ${sequence.photosTaken}</text></svg>`)}`,
        timestamp: new Date().toLocaleTimeString(),
      };
      setCurrentSetPhotos(prev => [...prev, newPhoto]);
    }
    lastPhotosTakenRef.current = sequence.photosTaken;
  }, [sequence.photosTaken]);

  // Clear photos only on explicit stop/reset, not when starting a new sequence (append mode)
  // Removed the auto-clear on scramble to allow appending photos to existing set

  // Handle photo_downloaded events from WebSocket
  const handlePhotoDownloaded = useCallback(async (event: PhotoDownloadedEvent) => {
    console.log('[PhotoboothWorkspace::handlePhotoDownloaded] START');
    console.log('[PhotoboothWorkspace::handlePhotoDownloaded] event:', event);

    // Immediately advance the sequence state machine (adds placeholder + moves to review/next)
    // This decouples state progression from the slower download pipeline
    sequence.notifyCaptureComplete();

    const filename = event.file_path.split('/').pop() || event.file_path;
    console.log('[PhotoboothWorkspace::handlePhotoDownloaded] extracted filename:', filename);

    if (!workingFolder) {
      // Show warning toast if working folder is not set
      console.warn('[PhotoboothWorkspace::handlePhotoDownloaded] Working folder not set, cannot save photo');
      setShowWorkingFolderWarning(true);
      // Auto-hide after 5 seconds
      setTimeout(() => setShowWorkingFolderWarning(false), 5000);
      return;
    }

    try {
      let sessionId = currentSession?.id;
      console.log('[PhotoboothWorkspace::handlePhotoDownloaded] initial sessionId:', sessionId);

      // Auto-create session if none exists
      if (!sessionId) {
        console.log('[PhotoboothWorkspace::handlePhotoDownloaded] No active session - auto-creating new session');

        // Extract parent folder name for session prefix
        const parentName = workingFolder.split(/[\\/]/).pop() || 'Session';

        // Find the highest numbered session to increment
        let nextNumber = 1;
        if (sessions.length > 0) {
          // Extract numbers from session names like "ParentName_set_001"
          const numbers = sessions
            .map(s => {
              const match = s.name.match(/_set_(\d+)$/);
              return match ? parseInt(match[1], 10) : 0;
            })
            .filter(n => n > 0);

          if (numbers.length > 0) {
            nextNumber = Math.max(...numbers) + 1;
          }
        }

        const sessionName = `${parentName}_set_${String(nextNumber).padStart(3, '0')}`;
        console.log('[PhotoboothWorkspace] Creating session:', sessionName);

        // Create the new session using the backend command
        const newSession = await invoke<{ id: string; name: string; folderName: string }>('create_photobooth_session', {
          folderPath: workingFolder,
          sessionName,
        });

        sessionId = newSession.id;
        console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Created session:', sessionId);

        // Load the newly created session as current
        await loadSession(sessionId);
        console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Loaded new session');
      }

      console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Calling download_photo_from_daemon with:', {
        daemonUrl: DAEMON_URL,
        filename,
        folderPath: workingFolder,
        sessionId,
        cameraPath: event.camera_path,
        originalDaemonPath: event.file_path,
      });

      // Download photo directly via Rust (bypasses slow JS ArrayBuffer → Array conversion)
      const updatedSession = await invoke<PtbSession>('download_photo_from_daemon', {
        daemonUrl: DAEMON_URL,
        filename,
        folderPath: workingFolder,
        sessionId,
        cameraPath: event.camera_path,
        originalDaemonPath: event.file_path,
      });

      console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Photo saved, session updated:', updatedSession);
      setPtbSession(updatedSession);

      // Update session state directly from the returned data (avoids expensive full refresh)
      updateCurrentSessionFromDownload({
        id: sessionId!,
        name: updatedSession.name,
        createdAt: updatedSession.createdAt,
        lastUsedAt: updatedSession.lastUsedAt,
        shotCount: updatedSession.shotCount,
        photos: updatedSession.photos,
      });
      console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Session state updated directly');

      // Replace placeholder thumbnail with actual photo
      const photoPath = `${workingFolder}/${sessionId}/${filename}`;
      console.log('[PhotoboothWorkspace::handlePhotoDownloaded] photoPath:', photoPath);
      const newPhoto: CurrentSetPhoto = {
        id: `photo-${Date.now()}`,
        thumbnailUrl: convertFileSrc(photoPath),
        timestamp: new Date().toLocaleTimeString(),
      };

      // Find and replace the first placeholder thumbnail (SVG data URL)
      setCurrentSetPhotos(prev => {
        const placeholderIndex = prev.findIndex(p => p.thumbnailUrl.startsWith('data:image/svg+xml'));
        if (placeholderIndex !== -1) {
          // Replace the placeholder with the real photo
          const updated = [...prev];
          updated[placeholderIndex] = newPhoto;
          console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Replaced placeholder at index:', placeholderIndex);
          return updated;
        }
        // If no placeholder found, append the new photo
        console.log('[PhotoboothWorkspace::handlePhotoDownloaded] No placeholder found, appending photo');
        return [...prev, newPhoto];
      });

    } catch (error) {
      console.error('[PhotoboothWorkspace::handlePhotoDownloaded] ERROR:', error);
    }
    console.log('[PhotoboothWorkspace::handlePhotoDownloaded] END');
  }, [workingFolder, currentSession, sessions, updateCurrentSessionFromDownload, loadSession, sequence.notifyCaptureComplete]);

  // Subscribe to photo_downloaded events
  useEffect(() => {
    addPhotoDownloadedListener(handlePhotoDownloaded);
    return () => {
      removePhotoDownloadedListener(handlePhotoDownloaded);
    };
  }, [handlePhotoDownloaded, addPhotoDownloadedListener, removePhotoDownloadedListener]);

  // Controls wrapper for UI compatibility
  const setAutoRunActive = (active: boolean) => {
    if (active) sequence.start();
    else sequence.stop();
  };

  // Show no camera warning toast
  const handleShowNoCameraWarning = () => {
    setShowNoCameraWarning(true);
    setTimeout(() => setShowNoCameraWarning(false), 3000);
  };

  // Each digit stops at different tick for cascading finish sequence
  const getScrambledDigit = (offset: number, stopTick: number) =>
    sequence.scrambleTick < stopTick ? (sequence.scrambleTick + offset) % 10 : 0;

  const togglePhotoSelection = (photoId: string) => {
    setSelectedPhotos(prev => {
      const newSet = new Set(prev);
      if (newSet.has(photoId)) {
        newSet.delete(photoId);
      } else {
        // Limit selection to frame zone count
        if (newSet.size < frameZoneCount) {
          newSet.add(photoId);
        }
      }
      return newSet;
    });
  };

  // Handler for creating next session
  const handleNextSession = async () => {
    if (!workingFolder) return;

    try {
      // Extract parent folder name for session prefix
      const parentName = workingFolder.split(/[\\/]/).pop() || 'Session';

      // Find the highest numbered session to increment
      let nextNumber = 1;
      if (sessions.length > 0) {
        const numbers = sessions
          .map(s => {
            const match = s.name.match(/_set_(\d+)$/);
            return match ? parseInt(match[1], 10) : 0;
          })
          .filter(n => n > 0);

        if (numbers.length > 0) {
          nextNumber = Math.max(...numbers) + 1;
        }
      }

      const sessionName = `${parentName}_set_${String(nextNumber).padStart(3, '0')}`;
      console.log('[PhotoboothWorkspace] Creating next session:', sessionName);

      // Create the new session using the backend command
      const newSession = await invoke<{ id: string; name: string; folderName: string }>('create_photobooth_session', {
        folderPath: workingFolder,
        sessionName,
      });

      console.log('[PhotoboothWorkspace] Created and switching to session:', newSession.id);

      // Load the new session
      await loadSession(newSession.id);

      // Clear current photos for the new session
      setCurrentSetPhotos([]);
    } catch (error) {
      console.error('[PhotoboothWorkspace] Error creating next session:', error);
    }
  };

  const toggleSet = (setId: string) => {
    setExpandedSets(prev => {
      const newSet = new Set(prev);
      if (newSet.has(setId)) {
        newSet.delete(setId);
      } else {
        newSet.add(setId);
      }
      return newSet;
    });
  };

  const selectedSet = sessions.find(set => set.id === selectedSetId);
  const currentPreset = displayPresets.find(p => p.id === displayMode);
  const modeIndex = displayPresets.findIndex(p => p.id === displayMode);

  // Handle keyboard navigation for fullscreen mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC to exit fullscreen
      if (e.key === 'Escape' && selectedPhotoIndex !== null && displayMode === 'canvas') {
        setSelectedPhotoIndex(null);
        return;
      }

      // Arrow key navigation in fullscreen mode
      if (selectedPhotoIndex !== null && displayMode === 'canvas') {
        const photoCount = currentSetPhotos.length || 6; // Use actual photo count or fallback to 6
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setSelectedPhotoIndex(prev => (prev !== null ? Math.max(0, prev - 1) : null));
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          setSelectedPhotoIndex(prev => (prev !== null ? Math.min(photoCount - 1, prev + 1) : null));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedPhotoIndex(prev => (prev !== null ? Math.max(0, prev - 3) : null));
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedPhotoIndex(prev => (prev !== null ? Math.min(photoCount - 1, prev + 3) : null));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPhotoIndex, displayMode, currentSetPhotos.length]);

  // Sync display mode to guest display
  useEffect(() => {
    updateDisplayMode(displayMode);
  }, [displayMode, updateDisplayMode]);

  // Sync selected photo index to guest display
  useEffect(() => {
    selectPhoto(selectedPhotoIndex);
  }, [selectedPhotoIndex, selectPhoto]);

  // Sync full state to guest display when photos change
  useEffect(() => {
    updateGuestDisplay({
      currentSetPhotos,
      selectedPhotoIndex,
      displayMode,
    });
  }, [currentSetPhotos, selectedPhotoIndex, displayMode, updateGuestDisplay]);

  // Listen for events from guest display
  useEffect(() => {
    let unlisteners: UnlistenFn[] = [];

    const setupListeners = async () => {
      const [unlisten1, unlisten2] = await Promise.all([
        listen('guest-display:escape', () => {
          setSelectedPhotoIndex(null);
        }),
        listen('guest-display:select-photo', (event: { payload: number | null }) => {
          setSelectedPhotoIndex(event.payload);
        }),
      ]);
      unlisteners = [unlisten1, unlisten2];
    };

    setupListeners();

    return () => {
      unlisteners.forEach(u => u());
    };
  }, []);

  // Handle navigation clicks for DisplayContent
  const handleNavClick = (direction: 'prev' | 'next') => {
    if (selectedPhotoIndex === null) return;
    const totalPhotos = currentSetPhotos.length || 6;
    const newIndex = direction === 'prev'
      ? Math.max(0, selectedPhotoIndex - 1)
      : Math.min(totalPhotos - 1, selectedPhotoIndex + 1);
    setSelectedPhotoIndex(newIndex);
  };

  return (
    <div className="photobooth-workspace">
      {/* Capture Error Modal */}
      <AnimatePresence>
        {captureError && (
          <motion.div
            className="capture-error-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={clearCaptureError}
          >
            <motion.div
              className="capture-error-modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="capture-error-header">
                <AlertTriangle size={24} className="capture-error-icon" />
                <span>Capture Error</span>
                <button className="capture-error-close" onClick={clearCaptureError}>
                  <X size={18} />
                </button>
              </div>
              <div className="capture-error-body">
                <p>{captureError}</p>
              </div>
              <div className="capture-error-footer">
                <button className="capture-error-btn" onClick={clearCaptureError}>
                  Dismiss
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="photobooth-container">
        {/* Main 16:9 Guest Display Area */}
        <div className="preview-area">
          <div className="preview-header">
            <div className="preview-title">
              <ImageIcon size={18} />
              <span>Guest Display</span>
            </div>
            <div className="preview-header-right">
              {/* Compact Mode Selector */}
              <div className="mode-selector-compact">
                {displayPresets.map((preset) => (
                  <button
                    key={preset.id}
                    className={`mode-tab-compact ${displayMode === preset.id ? 'active' : ''}`}
                    onClick={() => {
                      setDisplayMode(preset.id);
                      updateDisplayMode(preset.id);
                      setSelectedPhotoIndex(null);
                    }}
                    title={preset.description}
                  >
                    <preset.icon size={16} />
                  </button>
                ))}
              </div>
              <button
                className={`open-display-btn ${isSecondScreenOpen ? 'active' : ''}`}
                onClick={isSecondScreenOpen ? closeSecondScreen : openSecondScreen}
                title={isSecondScreenOpen ? "Close second screen" : "Open on second screen"}
              >
                <ExternalLink size={16} />
                <span>{isSecondScreenOpen ? 'Close Second Screen' : 'Open on Second Screen'}</span>
              </button>
            </div>
          </div>

          <div className="preview-frame-wrapper">
            <div className="preview-frame">
              <div className="preview-content">
                <DisplayContent
                  displayMode={displayMode}
                  currentSetPhotos={currentSetPhotos}
                  selectedPhotoIndex={selectedPhotoIndex}
                  onPhotoDoubleClick={setSelectedPhotoIndex}
                  onExitFullscreen={() => setSelectedPhotoIndex(null)}
                  liveViewStream={liveViewStream}
                  hdmiStreamUrl={hdmi.frameUrl}
                  onNavClick={handleNavClick}
                  showGridOverlay={true}
                  showRecentPhotos={true}
                  showBackButton={true}
                />
              </div>
            </div>
          </div>

          {/* Current Set Photo Strip */}
          <CurrentSetPhotoStrip
            currentSetPhotos={currentSetPhotos}
            selectedPhotos={selectedPhotos}
            setName={ptbSession?.name ?? null}
            workingFolder={workingFolder}
            frameName={currentFrame?.name ?? null}
            requiredPhotos={currentFrame?.zones.length ?? autoCount}
            onPhotoSelect={togglePhotoSelection}
            onNextSession={handleNextSession}
          />

          {/* Photobooth Controls */}
          <PhotoboothControls
            sequenceState={sequence.sequenceState}
            currentCountdown={sequence.currentCountdown}
            reviewCountdown={sequence.reviewCountdown}
            photosTaken={sequence.photosTaken}
            scrambleTick={sequence.scrambleTick}
            isActive={sequence.isActive}
            isPaused={sequence.isPaused}
            delayBetweenPhotos={delayBetweenPhotos}
            autoCount={autoCount}
            isCameraConnected={isCameraConnected}
            hasWorkingFolder={!!workingFolder}
            setDelayBetweenPhotos={setDelayBetweenPhotos}
            onToggleActive={() => setAutoRunActive(!sequence.isActive)}
            onPause={sequence.togglePause}
            onStopIfActive={sequence.stopIfActive}
            onCaptureNow={sequence.captureNow}
            onShowNoCameraWarning={handleShowNoCameraWarning}
            getScrambledDigit={getScrambledDigit}
          />
        </div>

        {/* Right Sidebar - Photo Sets Catalog */}
        <PhotoSessionsSidebar
          sessions={sessions}
          selectedSetId={selectedSetId}
          expandedSets={expandedSets}
          hasEverConnected={hasEverConnected}
          isCameraConnected={isCameraConnected}
          isConnecting={isConnecting}
          showWorkingFolderWarning={showWorkingFolderWarning}
          showNoCameraWarning={showNoCameraWarning}
          onSetSelect={setSelectedSetId}
          onToggleSet={toggleSet}
          onCloseSetDetail={() => setSelectedSetId(null)}
          onDismissWorkingFolderWarning={() => setShowWorkingFolderWarning(false)}
          onDismissNoCameraWarning={() => setShowNoCameraWarning(false)}
        />
      </div>
    </div>
  );
}

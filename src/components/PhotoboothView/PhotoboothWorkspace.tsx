import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown, ChevronRight, Calendar, Clock, Image as ImageIcon,
  ExternalLink, Camera, Grid3x3, Layers, Aperture, QrCode, Printer, Check, ArrowLeft, AlertTriangle, X, WifiOff, RefreshCw, FolderOpen
} from "lucide-react";
import { usePhotoboothSettings, type PhotoboothSessionInfo, type SessionPhoto } from "../../contexts/PhotoboothSettingsContext";
import { usePhotoboothSequence } from "../../hooks/usePhotoboothSequence";
import { useCamera } from "../../contexts/CameraContext";
import { useLiveView } from "../../contexts/LiveViewContext";
import { PhotoboothControls } from "./PhotoboothControls";
import DisplayContent from "./DisplayContent";
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

type WorkflowStep = 'select' | 'preview';

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
    currentSession
  } = usePhotoboothSettings();
  const { captureError, clearCaptureError, isCameraConnected, hasEverConnected, isConnecting, addPhotoDownloadedListener, removePhotoDownloadedListener } = useCamera();
  const { liveViewStream } = useLiveView();

  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set());
  const [displayMode, setDisplayMode] = useState<DisplayMode>('center');
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [currentSetPhotos, setCurrentSetPhotos] = useState<CurrentSetPhoto[]>([]);

  // Workflow state
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>('select');
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const frameZoneCount = 3; // TODO: Get from selected custom set

  // Working folder warning state
  const [showWorkingFolderWarning, setShowWorkingFolderWarning] = useState(false);
  // No camera warning state
  const [showNoCameraWarning, setShowNoCameraWarning] = useState(false);
  const [ptbSession, setPtbSession] = useState<PtbSession | null>(null);

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
    console.log('[PhotoboothWorkspace] Photo downloaded event:', event);

    // Extract filename from file_path (e.g., '/tmp/photos/DSCF0042.JPG' -> 'DSCF0042.JPG')
    const filename = event.file_path.split('/').pop() || event.file_path;

    if (!workingFolder) {
      // Show warning toast if working folder is not set
      console.warn('[PhotoboothWorkspace] Working folder not set, cannot save photo');
      setShowWorkingFolderWarning(true);
      // Auto-hide after 5 seconds
      setTimeout(() => setShowWorkingFolderWarning(false), 5000);
      return;
    }

    try {
      // Download photo directly via Rust (bypasses slow JS ArrayBuffer → Array conversion)
      const updatedSession = await invoke<PtbSession>('download_photo_from_daemon', {
        daemonUrl: DAEMON_URL,
        filename,
        folderPath: workingFolder,
        cameraPath: event.camera_path,
        originalDaemonPath: event.file_path,
      });

      console.log('[PhotoboothWorkspace] Photo saved, session updated:', updatedSession);
      setPtbSession(updatedSession);

      // Add photo to current set display with actual thumbnail
      const photoPath = `${workingFolder}/${filename}`;
      const newPhoto: CurrentSetPhoto = {
        id: `photo-${Date.now()}`,
        thumbnailUrl: convertFileSrc(photoPath),
        timestamp: new Date().toLocaleTimeString(),
      };
      setCurrentSetPhotos(prev => [...prev, newPhoto]);

    } catch (error) {
      console.error('[PhotoboothWorkspace] Error handling photo download:', error);
    }
  }, [workingFolder]);

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

  const canProceedToPreview = selectedPhotos.size > 0;

  const handleProceedToPreview = () => {
    if (canProceedToPreview) {
      setWorkflowStep('preview');
    }
  };

  const handleBackToSelect = () => {
    setWorkflowStep('select');
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
                  onNavClick={handleNavClick}
                  showGridOverlay={true}
                  showRecentPhotos={true}
                  showBackButton={true}
                />
              </div>
            </div>
          </div>

          {/* Current Set Photo Strip */}
          <div className="current-set-strip">
            <div className="current-set-header">
              <div className="workflow-steps">
                <button
                  className={`workflow-step ${workflowStep === 'select' ? 'active' : ''} ${workflowStep === 'preview' ? 'completed' : ''}`}
                  onClick={handleBackToSelect}
                >
                  <span className="step-number">1</span>
                  <span className="step-label">Select Photos</span>
                  {selectedPhotos.size > 0 && (
                    <span className="step-count">{selectedPhotos.size}/{frameZoneCount}</span>
                  )}
                </button>
                <div className="step-arrow">
                  <ChevronRight size={16} />
                </div>
                <button
                  className={`workflow-step ${workflowStep === 'preview' ? 'active' : ''}`}
                  onClick={handleProceedToPreview}
                  disabled={!canProceedToPreview}
                >
                  <span className="step-number">2</span>
                  <span className="step-label">Preview & Share</span>
                </button>
              </div>
            </div>

            {workflowStep === 'select' ? (
              <div className="current-set-photos">
                {currentSetPhotos.length === 0 ? (
                  <div className="current-set-empty">
                    <ImageIcon size={32} />
                    <span>No photos yet - capture photos to see them here</span>
                  </div>
                ) : (
                  currentSetPhotos.map((photo, idx) => (
                    <div
                      key={photo.id}
                      className={`current-set-photo ${selectedPhotos.has(photo.id) ? 'selected' : ''}`}
                      onClick={() => togglePhotoSelection(photo.id)}
                    >
                      <div className="current-set-photo-inner">
                        <ImageIcon size={36} />
                      </div>
                      <span className="current-set-photo-number">{idx + 1}</span>
                      {selectedPhotos.has(photo.id) && (
                        <div className="photo-selected-check">
                          <Check size={14} />
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="preview-result">
                <div className="preview-result-canvas">
                  <div className="preview-frame-zones">
                    {Array.from({ length: frameZoneCount }).map((_, idx) => {
                      const selectedPhotoIds = Array.from(selectedPhotos);
                      const photoId = selectedPhotoIds[idx];
                      return (
                        <div key={idx} className="preview-zone">
                          {photoId ? (
                            <div className="preview-zone-filled">
                              <ImageIcon size={24} />
                              <span>Photo {currentSetPhotos.findIndex(p => p.id === photoId) + 1}</span>
                            </div>
                          ) : (
                            <div className="preview-zone-empty">
                              <span>Empty</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="preview-actions">
                  <button className="preview-action-btn" onClick={handleBackToSelect}>
                    <ArrowLeft size={16} />
                    <span>Back</span>
                  </button>
                  <button className="preview-action-btn primary">
                    <QrCode size={16} />
                    <span>Generate QR</span>
                  </button>
                  <button className="preview-action-btn primary">
                    <Printer size={16} />
                    <span>Print</span>
                  </button>
                </div>
              </div>
            )}
          </div>

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
        <div className="catalog-sidebar">
          <div className="catalog-header">
            <h2 className="catalog-title">Photo Sessions</h2>
            <span className="catalog-count">{sessions.length} sessions</span>
          </div>

          <div className="catalog-list">
            <AnimatePresence mode="popLayout">
              {sessions.map((set) => {
                // Format date from createdAt
                const date = new Date(set.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                // Format time from lastUsedAt
                const time = new Date(set.lastUsedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

                return (
                  <motion.div
                    key={set.id}
                    layout
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className={`photo-set-card ${selectedSetId === set.id ? 'selected' : ''}`}
                  >
                    <button
                      className="photo-set-header"
                      onClick={() => {
                        setSelectedSetId(set.id);
                        toggleSet(set.id);
                      }}
                    >
                      <div className="photo-set-info">
                        <div className="photo-set-icon">
                          {expandedSets.has(set.id) ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                        </div>
                        <div className="photo-set-details">
                          <span className="photo-set-name">{set.name}</span>
                          <span className="photo-set-meta">
                            {set.shotCount} photos • {date}
                          </span>
                        </div>
                      </div>
                      <div className="photo-set-time">
                        <Clock size={12} />
                        <span>{time}</span>
                      </div>
                    </button>

                    <AnimatePresence>
                      {expandedSets.has(set.id) && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="photo-set-content"
                        >
                          <div className="photo-thumbnails">
                            {Array.from({ length: set.shotCount }).map((_, idx) => (
                              <div key={idx} className="thumbnail-placeholder">
                                <ImageIcon size={20} />
                                <span>Photo {idx + 1}</span>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {/* Selected Set Detail */}
          <AnimatePresence>
            {selectedSet && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="selected-set-detail"
              >
                <div className="detail-header">
                  <h3>{selectedSet.name}</h3>
                  <button
                    className="close-detail"
                    onClick={() => setSelectedSetId(null)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="detail-meta">
                  <span className="detail-item">
                    <Calendar size={12} />
                    {new Date(selectedSet.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  <span className="detail-item">
                    <Clock size={12} />
                    {new Date(selectedSet.lastUsedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="detail-item">
                    <ImageIcon size={12} />
                    {selectedSet.shotCount} photos
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Camera Connection Status Notification - Only show if camera was connected before */}
          <AnimatePresence>
            {hasEverConnected && !isCameraConnected && !isConnecting && (
              <motion.div
                className="connection-status-toast"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
              >
                <WifiOff size={16} className="connection-status-icon" />
                <div className="connection-status-text">
                  <span className="connection-status-title">Camera Disconnected</span>
                  <span className="connection-status-subtitle">
                    <RefreshCw size={12} className="spinning" />
                    Retrying connection...
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Camera Connecting Toast */}
          <AnimatePresence>
            {isConnecting && (
              <motion.div
                className="connection-status-toast connecting-toast"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
              >
                <RefreshCw size={16} className="connection-status-icon spinning" />
                <div className="connection-status-text">
                  <span className="connection-status-title">Connecting to Camera</span>
                  <span className="connection-status-subtitle">
                    Please wait...
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Working Folder Warning Toast */}
          <AnimatePresence>
            {showWorkingFolderWarning && (
              <motion.div
                className="connection-status-toast working-folder-warning"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                onClick={() => setShowWorkingFolderWarning(false)}
              >
                <FolderOpen size={16} className="connection-status-icon" />
                <div className="connection-status-text">
                  <span className="connection-status-title">No Working Folder Set</span>
                  <span className="connection-status-subtitle">
                    Photos cannot be saved. Set a working folder in Photobooth settings.
                  </span>
                </div>
                <button
                  className="toast-dismiss-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowWorkingFolderWarning(false);
                  }}
                >
                  <X size={14} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* No Camera Warning Toast */}
          <AnimatePresence>
            {showNoCameraWarning && (
              <motion.div
                className="connection-status-toast no-camera-warning"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                onClick={() => setShowNoCameraWarning(false)}
              >
                <WifiOff size={16} className="connection-status-icon" />
                <div className="connection-status-text">
                  <span className="connection-status-title">No Camera Connected</span>
                  <span className="connection-status-subtitle">
                    Connect a camera to capture photos.
                  </span>
                </div>
                <button
                  className="toast-dismiss-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowNoCameraWarning(false);
                  }}
                >
                  <X size={14} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

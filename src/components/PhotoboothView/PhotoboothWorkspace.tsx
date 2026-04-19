import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useCaptureTiming, useWorkspaceSettings, usePhotoboothSession } from "../../contexts";
import { usePhotoboothSequence } from "../../hooks";
import { useCamera } from "../../contexts";
import { useLiveView } from "../../contexts";
import { usePhotobooth } from "../../contexts";
import { useToast } from "../../contexts";
import { useUploadQueue } from "../../contexts";
import { useAuth } from "../../contexts";
import { useCustomSets } from "../../hooks";
import { useCollageUpload } from "../../hooks/useCollageUpload";
import { useSecondScreen } from "../../hooks";
import { useCapturePreviewState } from "../../hooks/photobooth/useCapturePreviewState";
import { useCurrentSetPhotos } from "../../hooks/photobooth/useCurrentSetPhotos";
import { useGuestDisplaySync } from "../../hooks/photobooth/useGuestDisplaySync";
import { useSessionWorkflow } from "../../hooks/photobooth/useSessionWorkflow";
import { usePhotoDownloadHandler } from "../../hooks/photobooth/usePhotoDownloadHandler";
import CaptureView from "./CaptureView";
import FinalizeView from "./FinalizeView";
import SessionSelectModal from "./SessionSelectModal";
import { displayPresets, type DisplayMode, type CurrentSetPhoto } from "./photoboothWorkspaceTypes";
import "./PhotoboothWorkspace.css";
import { createLogger } from '../../utils/logger';

const logger = createLogger('PhotoboothWorkspace');

export default function PhotoboothWorkspace() {
  const { timerDelay, autoCount, delayBetweenPhotos, photoReviewTime } = useCaptureTiming();
  const { workingFolder, photoNamingScheme, qrUploadEnabled, qrUploadAllImages } = useWorkspaceSettings();
  const { sessions, currentSession, loadSession, updateCurrentSessionFromDownload, createNewSession } = usePhotoboothSession();
  const { captureError, clearCaptureError, isCameraConnected, hasEverConnected, isConnecting, setDownloading, addPhotoDownloadedListener, removePhotoDownloadedListener } = useCamera();
  const { stream: liveViewStream, hdmi, ptp } = useLiveView();
  const { showToast } = useToast();
  const { photoboothFrame, finalizeViewMode, setFinalizeViewMode, setFinalizeEditingZoneId, placedImages, setPlacedImages } = usePhotobooth();
  const { enqueuePhotos } = useUploadQueue();
  const { account } = useAuth();
  const { customSets, selectedCustomSetId } = useCustomSets();
  const { uploadCollage } = useCollageUpload();

  // Get the selected set name from the custom sets
  const selectedSetName = customSets.find(s => s.id === selectedCustomSetId)?.name ?? null;

  // Local view mode synced with context
  const viewMode = finalizeViewMode;

  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set());
  const [displayMode, setDisplayMode] = useState<DisplayMode>('center');
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [previousDisplayMode, setPreviousDisplayMode] = useState<DisplayMode>('center');
  const [centerBrowseIndex, setCenterBrowseIndex] = useState<number | null>(null);

  // Slider for compact mode selector
  const [sliderStyles, setSliderStyles] = useState<{ left: number; width: number } | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const updateSliderPosition = useCallback((activeMode: DisplayMode) => {
    const activeTab = tabRefs.current[activeMode];
    if (activeTab) {
      setSliderStyles({
        left: activeTab.offsetLeft,
        width: activeTab.offsetWidth,
      });
    } else {
      setSliderStyles(null);
    }
  }, []);

  useEffect(() => {
    // Delay to ensure elements are rendered and measured correctly
    const timer = setTimeout(() => {
      updateSliderPosition(displayMode);
    }, 50); // Small delay
    return () => clearTimeout(timer);
  }, [displayMode, updateSliderPosition]);

  // Show toast when capture error occurs
  useEffect(() => {
    if (captureError) {
      showToast('Capture Error', 'error', 5000, captureError);
      clearCaptureError();
    }
  }, [captureError, showToast, clearCaptureError]);

  // Workflow state
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  // Calculate required photos from photobooth frame zones - 0 when no frame/set selected
  const requiredPhotos = photoboothFrame?.zones.length ?? 0;

  // Clear selected photos when session changes
  useEffect(() => {
    logger.debug('[PhotoboothWorkspace] Session changed, clearing selected photos');
    setSelectedPhotos([]);
    setSelectedPhotoIndex(null);
    setCenterBrowseIndex(null);
  }, [currentSession?.id]);

  // Second screen hook
  const { isSecondScreenOpen, openSecondScreen, closeSecondScreen, updateGuestDisplay, updateDisplayMode, selectPhoto, selectCenterPhoto, updateCountdown, updateDisplayLayout } = useSecondScreen();

  // Photobooth sequence hook - manages all timing state
  const sequence = usePhotoboothSequence({
    delayBeforeFirstPhoto: timerDelay,
    delayBetweenPhotos,
    photoReviewTime,
    autoCount,
    onPreviewLoaded: () => {
      // Called when entering waitingForPreview state
      logger.debug('[PhotoboothWorkspace] Entering waitingForPreview state');
    },
    onCaptureStart: () => setDownloading(true),
  });

  // Current set photos hook
  const { currentSetPhotos, setCurrentSetPhotos } = useCurrentSetPhotos({
    photosTaken: sequence.photosTaken,
    currentSession,
    workingFolder,
    sessions,
  });

  // Capture preview state hook
  const {
    showCapturePreview,
    capturedPhotoUrl,
    setCapturedPhotoUrl,
    setShowCapturePreview,
    previewTimerStartedRef,
    handleCapturePreviewLoad,
  } = useCapturePreviewState({
    sequence,
    updateGuestDisplay,
    currentSetPhotos,
    selectedPhotoIndex,
    displayMode,
  });

  // Guest display sync hook
  useGuestDisplaySync({
    secondScreen: { updateDisplayMode, selectPhoto, selectCenterPhoto, updateCountdown, updateGuestDisplay },
    displayMode,
    selectedPhotoIndex,
    centerBrowseIndex,
    currentSetPhotos,
    sequence,
    handleCapturePreviewLoad,
    setSelectedPhotoIndex,
  });

  // Session workflow hook
  const {
    showSessionSelectModal,
    pendingSessionToLoad,
    sessionQrData,
    handleNextSession,
    handleFinalizeSession,
    handleUploadCollage,
    handleBackToCapture,
    handleContinueSession,
    handleCreateNewSession,
  } = useSessionWorkflow({
    workingFolder,
    sessions,
    currentSession,
    loadSession,
    createNewSession,
    qrUploadEnabled,
    qrUploadAllImages,
    account,
    enqueuePhotos,
    currentSetPhotos,
    selectedPhotos,
    placedImages,
    setPlacedImages,
    setFinalizeViewMode,
    setFinalizeEditingZoneId,
    updateGuestDisplay,
    updateDisplayMode,
    displayMode,
    previousDisplayMode,
    setPreviousDisplayMode,
    setDisplayMode,
    uploadCollage,
    setCurrentSetPhotos,
    setExpandedSets,
    setSelectedSetId,
  });

  // Photo download handler hook
  usePhotoDownloadHandler({
    workingFolder,
    currentSession,
    sessions,
    photoNamingScheme,
    qrUploadEnabled,
    qrUploadAllImages,
    account,
    sequenceNotifyCaptureComplete: sequence.notifyCaptureComplete,
    sequenceIsActive: sequence.isActive,
    sequenceStartManualReview: sequence.startManualReview,
    updateCurrentSessionFromDownload,
    loadSession,
    enqueuePhotos,
    updateGuestDisplay,
    setCapturedPhotoUrl,
    setShowCapturePreview,
    previewTimerStartedRef,
    currentSetPhotos,
    selectedPhotoIndex,
    displayMode,
    setCurrentSetPhotos,
    addPhotoDownloadedListener,
    removePhotoDownloadedListener,
  });

  // Debug logging for QR data changes
  useEffect(() => {
    logger.debug('[PhotoboothWorkspace] sessionQrData changed:', {
      hasQrData: !!sessionQrData,
      qrDataLength: sessionQrData?.length || 0,
      currentSessionId: currentSession?.id,
    });
  }, [sessionQrData, currentSession?.id]);

  // Controls wrapper for UI compatibility
  const setAutoRunActive = useCallback((active: boolean) => {
    if (active) sequence.start();
    else sequence.stop();
  }, [sequence.start, sequence.stop]);

  const handleToggleActive = useCallback(
    () => setAutoRunActive(!sequence.isAutoRunning),
    [setAutoRunActive, sequence.isAutoRunning]
  );

  const handleCaptureStart = useCallback(() => setDownloading(true), [setDownloading]);

  // Show no camera warning toast
  const handleShowNoCameraWarning = useCallback(() => {
    showToast('No Camera Connected', 'error', 3000, 'Connect a camera to capture photos');
  }, [showToast]);

  // Show no working folder warning toast
  const handleShowNoWorkingFolderWarning = useCallback(() => {
    showToast('No Working Folder Set', 'warning', 5000, 'Select a folder in Photobooth settings');
  }, [showToast]);

  // Each digit stops at different tick for cascading finish sequence
  const getScrambledDigit = (offset: number, stopTick: number) =>
    sequence.scrambleTick < stopTick ? (sequence.scrambleTick + offset) % 10 : 0;

  const togglePhotoSelection = useCallback((photoId: string) => {
    // Completely lock photo selection when no set is selected
    if (requiredPhotos === 0) {
      showToast('No set selected', 'warning', 2000, 'Select a custom set in Control Center first');
      return;
    }

    setSelectedPhotos(prev => {
      const index = prev.indexOf(photoId);
      if (index !== -1) {
        // Remove photo from selection
        return prev.filter(id => id !== photoId);
      } else {
        // Limit selection to required photos from frame
        if (prev.length < requiredPhotos) {
          return [...prev, photoId];
        }
        return prev;
      }
    });
  }, [requiredPhotos, showToast]);

  const handleSelectAll = () => {
    setSelectedPhotos(currentSetPhotos.map(p => p.id));
  };

  const handleClearAll = () => {
    setSelectedPhotos([]);
  };

  // Get selected photos in order (preserving click order)
  const getSelectedPhotosOrdered = () => {
    return selectedPhotos.map(id => currentSetPhotos.find(p => p.id === id)).filter(Boolean) as CurrentSetPhoto[];
  };

  // Derive session folder name for file paths
  const sessionFolderName = (() => {
    const sessionInfo = sessions.find(s => s.id === currentSession?.id);
    return sessionInfo?.folderName || currentSession?.id || '';
  })();

  const toggleSet = (setId: string) => {
    setExpandedSets(prev => {
      // If clicking on already expanded set, collapse it
      if (prev.has(setId)) {
        return new Set();
      }
      // Otherwise, only expand this one set (accordion behavior)
      return new Set([setId]);
    });
  };

  const selectedSet = sessions.find(set => set.id === selectedSetId);
  const currentPreset = displayPresets.find(p => p.id === displayMode);
  const modeIndex = displayPresets.findIndex(p => p.id === displayMode);

  // Handle navigation clicks for DisplayContent
  const handleNavClick = useCallback((direction: 'prev' | 'next') => {
    setSelectedPhotoIndex(prev => {
      if (prev === null) return null;
      const totalPhotos = currentSetPhotos.length || 6;
      return direction === 'prev'
        ? Math.max(0, prev - 1)
        : Math.min(totalPhotos - 1, prev + 1);
    });
  }, [currentSetPhotos.length]);

  // Stable callbacks for DisplayContent (avoids breaking React.memo)
  const handleExitFullscreen = useCallback(() => setSelectedPhotoIndex(null), []);
  const handleCenterPhotoClick = useCallback((index: number) => setCenterBrowseIndex(index), []);
  const handleCenterBack = useCallback(() => setCenterBrowseIndex(null), []);
  const handleCenterNavClick = useCallback((direction: 'prev' | 'next') => {
    setCenterBrowseIndex(prev => {
      if (prev === null) return null;
      if (direction === 'prev') return Math.max(0, prev - 1);
      return Math.min(currentSetPhotos.length - 1, prev + 1);
    });
  }, [currentSetPhotos.length]);

  // Mode change handler for GuestDisplayHeader
  const handleModeChange = useCallback((mode: DisplayMode) => {
    setDisplayMode(mode);
    setSelectedPhotoIndex(null);
    // Reset center browse index when leaving center mode
    if (displayMode === 'center' && mode !== 'center') {
      setCenterBrowseIndex(null);
    }
  }, [displayMode]);

  // Toggle second screen handler
  const handleToggleSecondScreen = useCallback(() => {
    if (isSecondScreenOpen) {
      closeSecondScreen();
    } else {
      openSecondScreen({
        currentSetPhotos,
        selectedPhotoIndex,
        displayMode,
        centerBrowseIndex,
      });
    }
  }, [isSecondScreenOpen, closeSecondScreen, openSecondScreen, currentSetPhotos, selectedPhotoIndex, displayMode, centerBrowseIndex]);

  // Handle keyboard navigation for photo selection in canvas mode
  useEffect(() => {
    // Helper function to simulate a real mouse click with proper visual feedback
    const simulateMouseClick = (element: HTMLElement) => {
      // Get the center of the element
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      // Add active class manually since :active pseudo-class doesn't work with programmatic events
      element.classList.add('active');

      // Create and dispatch mousedown event
      const mouseDownEvent = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 1,
      });
      element.dispatchEvent(mouseDownEvent);

      // Create and dispatch click event
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 1,
      });
      element.dispatchEvent(clickEvent);

      // Create and dispatch mouseup event
      const mouseUpEvent = new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 0,
      });
      element.dispatchEvent(mouseUpEvent);

      // Remove active class after a short delay to show the press animation
      setTimeout(() => {
        element.classList.remove('active');
      }, 150);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Photobooth controls shortcuts - trigger button clicks for visual feedback and guards
      const captureBtn = document.getElementById('capture-btn');
      const autoBtn = document.getElementById('auto-btn');
      const holdBtn = document.getElementById('hold-btn');
      const intervalUpBtn = document.getElementById('interval-up-btn');
      const intervalDownBtn = document.getElementById('interval-down-btn');

      // Guest display mode shortcuts (only in capture mode)
      if (viewMode === 'capture') {
        if (e.key.toLowerCase() === 'q') {
          e.preventDefault();
          handleModeChange('single');
          return;
        }
        if (e.key.toLowerCase() === 'w') {
          e.preventDefault();
          handleModeChange('center');
          return;
        }
        if (e.key.toLowerCase() === 'e') {
          e.preventDefault();
          handleModeChange('canvas');
          return;
        }

        // Toggle photo selection with 1-9 (1-9) and 0 (10)
        if (/^[0-9]$/.test(e.key)) {
          const num = parseInt(e.key);
          const index = num === 0 ? 9 : num - 1;
          if (currentSetPhotos[index]) {
            e.preventDefault();
            togglePhotoSelection(currentSetPhotos[index].id);
          }
          return;
        }
      }

      // Space/Enter for shutter (capture now)
      // Guard: disabled when sequence.isActive or sequence.isAutoRunning
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && captureBtn) {
        e.preventDefault();
        if (!sequence.isActive && !sequence.isAutoRunning) {
          simulateMouseClick(captureBtn);
        }
        return;
      }

      // A for auto toggle
      // Guard: disabled when !isAutoRunning && (!canStartAuto || isActive)
      // canStartAuto = isCameraConnected && hasWorkingFolder
      if ((e.key === 'a' || e.key === 'A') && autoBtn) {
        e.preventDefault();
        const canStartAuto = isCameraConnected && !!workingFolder;
        const canToggle = sequence.isAutoRunning || (canStartAuto && !sequence.isActive);
        if (canToggle) {
          simulateMouseClick(autoBtn);
        }
        return;
      }

      // H for hold/pause toggle
      // Guard: disabled when !isAutoRunning
      if ((e.key === 'h' || e.key === 'H') && holdBtn) {
        e.preventDefault();
        if (sequence.isAutoRunning) {
          simulateMouseClick(holdBtn);
        }
        return;
      }

      // Arrow up/down for interval adjustment (only when not in canvas photo navigation)
      if (selectedPhotoIndex === null || displayMode !== 'canvas') {
        if (e.key === 'ArrowUp' && intervalUpBtn) {
          e.preventDefault();
          simulateMouseClick(intervalUpBtn);
          return;
        } else if (e.key === 'ArrowDown' && intervalDownBtn) {
          e.preventDefault();
          simulateMouseClick(intervalDownBtn);
          return;
        }
      }

      // ESC to deselect photo
      if (e.key === 'Escape' && selectedPhotoIndex !== null && displayMode === 'canvas') {
        setSelectedPhotoIndex(null);
        return;
      }

      // Arrow key navigation in canvas mode
      if (selectedPhotoIndex !== null && displayMode === 'canvas') {
        const photoCount = currentSetPhotos.length || 6;
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
  }, [selectedPhotoIndex, displayMode, currentSetPhotos, sequence, isCameraConnected, workingFolder, viewMode, handleModeChange, togglePhotoSelection]);

  return (
    <div className="photobooth-workspace">
      <div className="photobooth-slide-container">
        {/* Render both views and toggle visibility to keep state in memory */}
        <div 
          className="view-wrapper" 
          style={{ 
            display: viewMode === 'capture' ? 'block' : 'none',
            position: 'absolute',
            inset: 0 
          }}
        >
          <CaptureView
            displayMode={displayMode}
            sliderStyles={sliderStyles}
            tabRefs={tabRefs}
            displayPresets={displayPresets}
            isSecondScreenOpen={isSecondScreenOpen}
            onModeChange={handleModeChange}
            onToggleSecondScreen={handleToggleSecondScreen}
            currentSetPhotos={currentSetPhotos}
            selectedPhotoIndex={selectedPhotoIndex}
            centerBrowseIndex={centerBrowseIndex}
            selectedPhotos={selectedPhotos}
            liveViewStream={liveViewStream}
            hdmiStreamUrl={hdmi.frameUrl || ptp.frameUrl}
            showCapturePreview={showCapturePreview}
            capturedPhotoUrl={capturedPhotoUrl}
            onCapturePreviewLoad={handleCapturePreviewLoad}
            onPhotoDoubleClick={setSelectedPhotoIndex}
            onExitFullscreen={handleExitFullscreen}
            onNavClick={handleNavClick}
            onCenterPhotoClick={handleCenterPhotoClick}
            onCenterBack={handleCenterBack}
            onCenterNavClick={handleCenterNavClick}
            onPhotoSelect={togglePhotoSelection}
            onSelectAll={handleSelectAll}
            onClearAll={handleClearAll}
            currentSession={currentSession}
            ptbSessionName={null}
            workingFolder={workingFolder}
            selectedSetName={selectedSetName}
            requiredPhotos={requiredPhotos}
            onNextSession={handleNextSession}
            onFinalize={handleFinalizeSession}
            sequence={sequence}
            autoCount={autoCount}
            isCameraConnected={isCameraConnected}
            hasWorkingFolder={!!workingFolder}
            onToggleActive={handleToggleActive}
            onCaptureStart={handleCaptureStart}
            onShowNoCameraWarning={handleShowNoCameraWarning}
            onShowNoWorkingFolderWarning={handleShowNoWorkingFolderWarning}
            getScrambledDigit={getScrambledDigit}
            sessions={sessions}
            selectedSetId={selectedSetId}
            expandedSets={expandedSets}
            isConnecting={isConnecting}
            onSetSelect={setSelectedSetId}
            onToggleSet={toggleSet}
            onLoadSession={loadSession}
          />
        </div>

        <div 
          className="view-wrapper finalize-mode" 
          style={{ 
            display: viewMode === 'finalize' ? 'block' : 'none',
            position: 'absolute',
            inset: 0 
          }}
        >
          {photoboothFrame && (
            <FinalizeView
              frame={photoboothFrame}
              selectedPhotos={getSelectedPhotosOrdered()}
              workingFolder={workingFolder!}
              sessionFolderName={sessionFolderName}
              onBack={handleBackToCapture}
              updateGuestDisplay={updateGuestDisplay}
              updateDisplayLayout={updateDisplayLayout}
              isSecondScreenOpen={isSecondScreenOpen}
              openSecondScreen={openSecondScreen}
              qrData={sessionQrData}
              onDisplayShown={handleUploadCollage}
            />
          )}
        </div>
      </div>

      {/* Session Selection Modal */}
      <SessionSelectModal
        isOpen={showSessionSelectModal}
        sessions={sessions}
        pendingSession={pendingSessionToLoad}
        onContinue={handleContinueSession}
        onCreateNew={handleCreateNewSession}
      />
    </div>
  );
}

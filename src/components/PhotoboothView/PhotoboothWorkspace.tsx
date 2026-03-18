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
import { displayPresets, type DisplayMode } from "./photoboothWorkspaceTypes";
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
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  // Calculate required photos from photobooth frame zones - 0 when no frame/set selected
  const requiredPhotos = photoboothFrame?.zones.length ?? 0;

  // Clear selected photos when session changes
  useEffect(() => {
    logger.debug('[PhotoboothWorkspace] Session changed, clearing selected photos');
    setSelectedPhotos(new Set());
    setSelectedPhotoIndex(null);
    setCenterBrowseIndex(null);
  }, [currentSession?.id]);

  // Second screen hook
  const { isSecondScreenOpen, openSecondScreen, closeSecondScreen, updateGuestDisplay, updateDisplayMode, selectPhoto, selectCenterPhoto, updateCountdown } = useSecondScreen();

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

  const togglePhotoSelection = (photoId: string) => {
    // Completely lock photo selection when no set is selected
    if (requiredPhotos === 0) {
      showToast('No set selected', 'warning', 2000, 'Select a custom set in Control Center first');
      return;
    }

    setSelectedPhotos(prev => {
      const newSet = new Set(prev);
      if (newSet.has(photoId)) {
        newSet.delete(photoId);
      } else {
        // Limit selection to required photos from frame
        if (newSet.size < requiredPhotos) {
          newSet.add(photoId);
        }
      }
      return newSet;
    });
  };

  // Get selected photos in order (preserving capture order)
  const getSelectedPhotosOrdered = () => {
    return currentSetPhotos.filter(p => selectedPhotos.has(p.id));
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

  // Handle keyboard navigation for photo selection in canvas mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
  }, [selectedPhotoIndex, displayMode, currentSetPhotos.length]);

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
  }, []);

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

  return (
    <div className="photobooth-workspace">
      <div className="photobooth-slide-container">
        <AnimatePresence mode="sync">
          {viewMode === 'capture' ? (
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
              hasEverConnected={hasEverConnected}
              isConnecting={isConnecting}
              onSetSelect={setSelectedSetId}
              onToggleSet={toggleSet}
              onLoadSession={loadSession}
            />
          ) : (
            <motion.div
              key="finalize"
              className="photobooth-container finalize-mode"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.8, ease: 'easeInOut' }}
              style={{ position: 'absolute', inset: 0 }}
            >
              <FinalizeView
                frame={photoboothFrame!}
                selectedPhotos={getSelectedPhotosOrdered()}
                workingFolder={workingFolder!}
                sessionFolderName={sessionFolderName}
                onBack={handleBackToCapture}
                updateGuestDisplay={updateGuestDisplay}
                isSecondScreenOpen={isSecondScreenOpen}
                openSecondScreen={openSecondScreen}
                qrData={sessionQrData}
                onDisplayShown={handleUploadCollage}
              />
            </motion.div>
          )}
        </AnimatePresence>
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

import { motion } from "framer-motion";
import { useCallback, useRef, useState } from "react";
import type { CurrentSetPhoto, DisplayMode, DisplayPreset } from "./photoboothWorkspaceTypes";
import type { PhotoboothSessionInfo, PhotoboothSession } from "../../contexts/photobooth/PhotoboothSettingsContext";
import type { SequenceState, ManualPhase } from "../../hooks/photobooth/usePhotoboothSequence";
import GuestDisplayHeader from "./GuestDisplayHeader";
import DisplayContent from "./DisplayContent";
import CurrentSetPhotoStrip from "./CurrentSetPhotoStrip";
import { PhotoboothControls } from "./PhotoboothControls";
import { PhotoSessionsSidebar } from "../Sidebar/Sessions";

const PANEL_MIN = 330;
const PANEL_MAX = 410;
const PANEL_DEFAULT = 340;
const STORAGE_KEY = 'capture-bottom-panel-height';

interface CaptureViewProps {
  // Display state
  displayMode: DisplayMode;
  sliderStyles: { left: number; width: number } | null;
  tabRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>;
  displayPresets: DisplayPreset[];
  isSecondScreenOpen: boolean;
  onModeChange: (mode: DisplayMode) => void;
  onToggleSecondScreen: () => void;

  // Photos
  currentSetPhotos: CurrentSetPhoto[];
  selectedPhotoIndex: number | null;
  centerBrowseIndex: number | null;
  selectedPhotos: string[];

  // Live view
  liveViewStream: MediaStream | null;
  hdmiStreamUrl: string | null;

  // Capture preview
  showCapturePreview: boolean;
  capturedPhotoUrl: string | null;
  onCapturePreviewLoad: () => void;

  // Photo interactions
  onPhotoDoubleClick: (index: number) => void;
  onExitFullscreen: () => void;
  onNavClick: (direction: 'prev' | 'next') => void;
  onCenterPhotoClick: (index: number) => void;
  onCenterBack: () => void;
  onCenterNavClick: (direction: 'prev' | 'next') => void;
  onPhotoSelect: (photoId: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;

  // Session strip
  currentSession: PhotoboothSession | null;
  ptbSessionName: string | null;
  workingFolder: string | null;
  selectedSetName: string | null;
  requiredPhotos: number;
  onNextSession: () => void;
  onFinalize: () => void;

  // Controls
  sequence: {
    sequenceState: SequenceState;
    currentCountdown: number;
    reviewCountdown: number;
    photosTaken: number;
    scrambleTick: number;
    isActive: boolean;
    isAutoRunning: boolean;
    isPaused: boolean;
    manualPhase: ManualPhase;
    manualReviewCountdown: number;
    togglePause: () => void;
    stopIfActive: () => void;
    captureNow: () => void;
    adjustCountdown: (delta: number) => void;
  };
  autoCount: number;
  isCameraConnected: boolean;
  hasWorkingFolder: boolean;
  onToggleActive: () => void;
  onCaptureStart: () => void;
  onShowNoCameraWarning: () => void;
  onShowNoWorkingFolderWarning: () => void;
  getScrambledDigit: (offset: number, stopTick: number) => number;

  // Sidebar
  sessions: PhotoboothSessionInfo[];
  selectedSetId: string | null;
  expandedSets: Set<string>;
  isConnecting: boolean;
  onSetSelect: (id: string | null) => void;
  onToggleSet: (id: string) => void;
  onLoadSession: (sessionId: string) => Promise<void>;
}

export default function CaptureView({
  displayMode,
  sliderStyles,
  tabRefs,
  displayPresets,
  isSecondScreenOpen,
  onModeChange,
  onToggleSecondScreen,
  currentSetPhotos,
  selectedPhotoIndex,
  centerBrowseIndex,
  selectedPhotos,
  liveViewStream,
  hdmiStreamUrl,
  showCapturePreview,
  capturedPhotoUrl,
  onCapturePreviewLoad,
  onPhotoDoubleClick,
  onExitFullscreen,
  onNavClick,
  onCenterPhotoClick,
  onCenterBack,
  onCenterNavClick,
  onPhotoSelect,
  onSelectAll,
  onClearAll,
  currentSession,
  ptbSessionName,
  workingFolder,
  selectedSetName,
  requiredPhotos,
  onNextSession,
  onFinalize,
  sequence,
  autoCount,
  isCameraConnected,
  hasWorkingFolder,
  onToggleActive,
  onCaptureStart,
  onShowNoCameraWarning,
  onShowNoWorkingFolderWarning,
  getScrambledDigit,
  sessions,
  selectedSetId,
  expandedSets,
  isConnecting,
  onSetSelect,
  onToggleSet,
  onLoadSession,
}: CaptureViewProps) {
  const [panelHeight, setPanelHeight] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const n = parseInt(saved, 10);
      if (!isNaN(n)) return Math.max(PANEL_MIN, Math.min(PANEL_MAX, n));
    }
    return PANEL_DEFAULT;
  });

  const [isDragging, setIsDragging] = useState(false);
  const panelHeightRef = useRef(panelHeight);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startY = e.clientY;
    const startHeight = panelHeightRef.current;
    // Capture wrapper height once — panel can only grow by however much wrapper exceeds its min
    const wrapperH = wrapperRef.current?.clientHeight ?? 200;
    const effectiveMax = Math.min(PANEL_MAX, startHeight + Math.max(0, wrapperH - 80));

    const onMouseMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const next = Math.max(PANEL_MIN, Math.min(effectiveMax, startHeight + delta));
      panelHeightRef.current = next;
      setPanelHeight(next);
    };

    const onMouseUp = () => {
      setIsDragging(false);
      localStorage.setItem(STORAGE_KEY, String(panelHeightRef.current));
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // Keep ref in sync with state
  panelHeightRef.current = panelHeight;

  return (
    <motion.div
      key="capture"
      className="photobooth-container"
      initial={false}
      animate={{ x: 0 }}
      exit={{ x: '-100%' }}
      transition={{ type: 'tween', duration: 0.35, ease: 'easeInOut' }}
      style={{ position: 'absolute', inset: 0 }}
    >
      {/* Main 16:9 Guest Display Area */}
      <div className="preview-area">
        <GuestDisplayHeader
          displayMode={displayMode}
          sliderStyles={sliderStyles}
          isSecondScreenOpen={isSecondScreenOpen}
          currentSetPhotos={currentSetPhotos}
          selectedPhotoIndex={selectedPhotoIndex}
          centerBrowseIndex={centerBrowseIndex}
          onModeChange={onModeChange}
          onToggleSecondScreen={onToggleSecondScreen}
          displayPresets={displayPresets}
          tabRefs={tabRefs}
        />

        <div className="preview-frame-wrapper" ref={wrapperRef}>
          <div className="preview-frame">
            <div className="preview-content">
              <DisplayContent
                displayMode={displayMode}
                currentSetPhotos={currentSetPhotos}
                selectedPhotoIndex={selectedPhotoIndex}
                onPhotoDoubleClick={onPhotoDoubleClick}
                onExitFullscreen={onExitFullscreen}
                liveViewStream={displayMode === 'single' || displayMode === 'center' ? liveViewStream : null}
                hdmiStreamUrl={displayMode === 'single' || displayMode === 'center' ? hdmiStreamUrl : null}
                onNavClick={onNavClick}
                showGridOverlay={true}
                showRecentPhotos={true}
                showBackButton={true}
                showCapturePreview={showCapturePreview}
                capturedPhotoUrl={capturedPhotoUrl}
                onCapturePreviewLoad={onCapturePreviewLoad}
                centerBrowseIndex={centerBrowseIndex}
                onCenterPhotoClick={onCenterPhotoClick}
                onCenterBack={onCenterBack}
                onCenterNavClick={onCenterNavClick}
              />
            </div>
          </div>
        </div>

        {/* Bottom Panel: Current Set Strip + Controls */}
        <div className="capture-bottom-panel" style={{ height: panelHeight }}>
          <CurrentSetPhotoStrip
            currentSetPhotos={currentSetPhotos}
            selectedPhotos={selectedPhotos}
            setName={currentSession?.name ?? ptbSessionName ?? null}
            workingFolder={workingFolder}
            frameName={selectedSetName}
            requiredPhotos={requiredPhotos}
            onPhotoSelect={onPhotoSelect}
            onSelectAll={onSelectAll}
            onClearAll={onClearAll}
            onNextSession={onNextSession}
            onFinalize={onFinalize}
            onResizeDragStart={handleDragStart}
            isResizing={isDragging}
          />

          <PhotoboothControls
            sequenceState={sequence.sequenceState}
            currentCountdown={sequence.currentCountdown}
            reviewCountdown={sequence.reviewCountdown}
            photosTaken={sequence.photosTaken}
            scrambleTick={sequence.scrambleTick}
            isActive={sequence.isActive}
            isAutoRunning={sequence.isAutoRunning}
            isPaused={sequence.isPaused}
            manualPhase={sequence.manualPhase}
            manualReviewCountdown={sequence.manualReviewCountdown}
            autoCount={autoCount}
            isCameraConnected={isCameraConnected}
            hasWorkingFolder={hasWorkingFolder}
            onIntervalUp={() => sequence.adjustCountdown(3)}
            onIntervalDown={() => sequence.adjustCountdown(-3)}
            onToggleActive={onToggleActive}
            onPause={sequence.togglePause}
            onStopIfActive={sequence.stopIfActive}
            onCaptureNow={sequence.captureNow}
            onCaptureStart={onCaptureStart}
            onShowNoCameraWarning={onShowNoCameraWarning}
            onShowNoWorkingFolderWarning={onShowNoWorkingFolderWarning}
            getScrambledDigit={getScrambledDigit}
          />
        </div>
      </div>

      {/* Right Sidebar - Photo Sets Catalog */}
      <PhotoSessionsSidebar
        sessions={sessions}
        selectedSetId={selectedSetId}
        expandedSets={expandedSets}
        isCameraConnected={isCameraConnected}
        isConnecting={isConnecting}
        onSetSelect={onSetSelect}
        onToggleSet={onToggleSet}
        onLoadSession={onLoadSession}
        currentSessionId={currentSession?.id}
      />
    </motion.div>
  );
}

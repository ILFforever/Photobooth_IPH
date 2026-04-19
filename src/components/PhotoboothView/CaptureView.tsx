import { motion } from "framer-motion";
import type { CurrentSetPhoto, DisplayMode, DisplayPreset } from "./photoboothWorkspaceTypes";
import type { PhotoboothSessionInfo, PhotoboothSession } from "../../contexts/photobooth/PhotoboothSettingsContext";
import type { SequenceState, ManualPhase } from "../../hooks/photobooth/usePhotoboothSequence";
import GuestDisplayHeader from "./GuestDisplayHeader";
import DisplayContent from "./DisplayContent";
import CurrentSetPhotoStrip from "./CurrentSetPhotoStrip";
import { PhotoboothControls } from "./PhotoboothControls";
import { PhotoSessionsSidebar } from "../Sidebar/Sessions";

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
  hasEverConnected: boolean;
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
  hasEverConnected,
  isConnecting,
  onSetSelect,
  onToggleSet,
  onLoadSession,
}: CaptureViewProps) {
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

        <div className="preview-frame-wrapper">
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
        <div className="capture-bottom-panel">
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
        hasEverConnected={hasEverConnected}
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

import { memo, useState, useEffect } from "react";

// 7-Segment Digit Component
interface SevenSegmentDigitProps {
  value: number;
  dash?: boolean;
}

function SevenSegmentDigit({ value, dash }: SevenSegmentDigitProps) {
  if (dash) {
    return (
      <div className="segment-digit">
        <span className={`seg seg-h mid on`}></span>
      </div>
    );
  }

  const digit = Math.min(9, Math.max(0, value));

  const segments = {
    a: ![1, 4].includes(digit),
    b: ![5, 6].includes(digit),
    c: ![2].includes(digit),
    d: ![1, 4, 7].includes(digit),
    e: ![1, 3, 4, 5, 7, 9].includes(digit),
    f: ![1, 2, 3, 7].includes(digit),
    g: ![0, 1, 7].includes(digit),
  };

  return (
    <div className="segment-digit" data-digit={digit}>
      <span className={`seg seg-h top ${segments.a ? 'on' : ''}`}></span>
      <span className={`seg seg-v tl ${segments.f ? 'on' : ''}`}></span>
      <span className={`seg seg-v tr ${segments.b ? 'on' : ''}`}></span>
      <span className={`seg seg-h mid ${segments.g ? 'on' : ''}`}></span>
      <span className={`seg seg-v bl ${segments.e ? 'on' : ''}`}></span>
      <span className={`seg seg-v br ${segments.c ? 'on' : ''}`}></span>
      <span className={`seg seg-h bot ${segments.d ? 'on' : ''}`}></span>
    </div>
  );
}

// Loading Animation Component - cycles through segments
function LoadingSegmentDigit() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => (t + 1) % 14), 80);
    return () => clearInterval(interval);
  }, []);

  // Cycle through segments in a pattern
  const segments = {
    a: tick % 14 < 7,
    b: (tick + 2) % 14 < 7,
    c: (tick + 4) % 14 < 7,
    d: (tick + 6) % 14 < 7,
    e: (tick + 8) % 14 < 7,
    f: (tick + 10) % 14 < 7,
    g: (tick + 12) % 14 < 7,
  };

  return (
    <div className="segment-digit loading-animation">
      <span className={`seg seg-h top ${segments.a ? 'on' : ''}`}></span>
      <span className={`seg seg-v tl ${segments.f ? 'on' : ''}`}></span>
      <span className={`seg seg-v tr ${segments.b ? 'on' : ''}`}></span>
      <span className={`seg seg-h mid ${segments.g ? 'on' : ''}`}></span>
      <span className={`seg seg-v bl ${segments.e ? 'on' : ''}`}></span>
      <span className={`seg seg-v br ${segments.c ? 'on' : ''}`}></span>
      <span className={`seg seg-h bot ${segments.d ? 'on' : ''}`}></span>
    </div>
  );
}

interface DisplayStripProps {
  sequenceState: string;
  currentCountdown: number;
  reviewCountdown: number;
  photosTaken: number;
  autoCount: number;
  scrambleTick: number;
  manualPhase: string;
  manualReviewCountdown: number;
  getScrambledDigit: (offset: number, stopTick: number) => number;
}

function DisplayStrip({
  sequenceState,
  currentCountdown,
  reviewCountdown,
  photosTaken,
  autoCount,
  scrambleTick,
  manualPhase,
  manualReviewCountdown,
  getScrambledDigit,
}: DisplayStripProps) {
  // Manual capture takes priority over auto display
  const isManualActive = manualPhase !== 'idle';
  const showReviewLabel = isManualActive || sequenceState === 'review' || sequenceState === 'waitingForPreview';
  const showYellow = (isManualActive && manualPhase === 'review') || sequenceState === 'review';

  return (
    <div className="te-display-strip">
      {/* Corner brackets - TE style */}
      <span className="te-corner te-corner-tl">┌</span>
      <span className="te-corner te-corner-tr">┐</span>
      <span className="te-corner te-corner-bl">└</span>
      <span className="te-corner te-corner-br">┘</span>

      {/* Timer/Review Display */}
      <div className="te-display-section">
        <div className="display-label">
          {showReviewLabel ? 'REVIEW' : 'INT'}
        </div>
        <div className={`seven-segment-display ${showYellow ? 'yellow-mode' : ''}`}>
          {/* Manual capture display (takes priority) */}
          {isManualActive ? (
            manualPhase === 'waiting' ? (
              <>
                <LoadingSegmentDigit />
                <LoadingSegmentDigit />
              </>
            ) : (
              <>
                <SevenSegmentDigit value={Math.floor(manualReviewCountdown / 10)} />
                <SevenSegmentDigit value={manualReviewCountdown % 10} />
              </>
            )
          ) : /* Auto sequence display */
          sequenceState === 'waitingForPreview' ? (
            <>
              <LoadingSegmentDigit />
              <LoadingSegmentDigit />
            </>
          ) : sequenceState === 'preCountdown' ? (
            <>
              <SevenSegmentDigit value={0} dash />
              <SevenSegmentDigit value={0} dash />
            </>
          ) : sequenceState === 'review' ? (
            <>
              <SevenSegmentDigit value={Math.floor(reviewCountdown / 10)} />
              <SevenSegmentDigit value={reviewCountdown % 10} />
            </>
          ) : (
            <>
              <SevenSegmentDigit value={scrambleTick < 6 ? getScrambledDigit(0, 6) : Math.floor(currentCountdown / 10)} />
              <SevenSegmentDigit value={scrambleTick < 10 ? getScrambledDigit(3, 10) : currentCountdown % 10} />
            </>
          )}
        </div>
        <div className="display-unit">SEC</div>
      </div>

      {/* TE-style divider */}
      <span className="te-divider">◆</span>

      {/* Photo Count Display */}
      <div className="te-display-section">
        <div className="display-label">TAKEN</div>
        <div className="seven-segment-display">
          <SevenSegmentDigit value={sequenceState === 'scramble' && scrambleTick < 14 ? getScrambledDigit(7, 14) : photosTaken} />
          <SevenSegmentDigit value={0} dash />
          <SevenSegmentDigit value={sequenceState === 'scramble' && scrambleTick < 18 ? getScrambledDigit(1, 18) : (autoCount - photosTaken)} />
        </div>
        <div className="display-unit">REMAIN</div>
      </div>

      {/* Orange accent stripe */}
      <span className="te-accent"></span>
    </div>
  );
}

interface LEDBarProps {
  isAutoRunning: boolean;
  isPaused: boolean;
}

function LEDBar({ isAutoRunning, isPaused }: LEDBarProps) {
  return (
    <div className="led-bar">
      <div className={`led led-power ${isAutoRunning ? 'led-on' : ''}`}>
        <span className="led-lens"></span>
        <span className="led-label">PWR</span>
      </div>
      <div className={`led led-run ${isAutoRunning && !isPaused ? 'led-on' : ''}`}>
        <span className="led-lens"></span>
        <span className="led-label">RUN</span>
      </div>
    </div>
  );
}

interface ControlButtonsProps {
  onIntervalUp: () => void;
  onIntervalDown: () => void;
  isActive: boolean;
  isAutoRunning: boolean;
  isPaused: boolean;
  isCameraConnected: boolean;
  hasWorkingFolder: boolean;
  onToggleActive: () => void;
  onPause: () => void;
  onStopIfActive: () => void;
  onCaptureNow: () => void;
  onShowNoCameraWarning: () => void;
  onShowNoWorkingFolderWarning: () => void;
}

function ControlButtons({
  onIntervalUp,
  onIntervalDown,
  isActive,
  isAutoRunning,
  isPaused,
  isCameraConnected,
  hasWorkingFolder,
  onToggleActive,
  onPause,
  onStopIfActive,
  onCaptureNow,
  onShowNoCameraWarning,
  onShowNoWorkingFolderWarning,
}: ControlButtonsProps) {
  const canStartAuto = isCameraConnected && hasWorkingFolder;

  const handleCaptureClick = () => {
    if (!isCameraConnected) {
      onShowNoCameraWarning();
      return;
    }
    if (!hasWorkingFolder) {
      onShowNoWorkingFolderWarning();
      return;
    }
    onStopIfActive();
    onCaptureNow();
  };

  return (
    <div className="controls-section">
      <div className="control-group">
        <div className="control-label">INTERVAL</div>
        <div className="button-row">
          <button className="ctrl-btn" onClick={onIntervalUp}>
            <span>▲</span>
          </button>
          <button className="ctrl-btn" onClick={onIntervalDown}>
            <span>▼</span>
          </button>
        </div>
      </div>

      <div className="control-group">
        <div className="control-label">TRANSPORT</div>
        <div className="button-row">
          <button
            className={`ctrl-btn ${!isAutoRunning ? 'auto-idle' : 'auto-running'}`}
            onClick={onToggleActive}
            disabled={!isAutoRunning && (!canStartAuto || isActive)}
            title={!canStartAuto ? (!isCameraConnected ? 'Camera not connected' : 'No working folder selected') : ''}
          >
            <span>{isAutoRunning ? '■' : '▶'}</span>
            <span className="btn-label">{isAutoRunning ? 'STOP' : 'AUTO'}</span>
          </button>
          <button
            className={`ctrl-btn ${isPaused ? 'hold-active' : ''}`}
            onClick={onPause}
            disabled={!isAutoRunning}
          >
            <span>⏸</span>
            <span className="btn-label">HOLD</span>
          </button>
        </div>
      </div>

      <button
        className="capture-btn"
        onClick={handleCaptureClick}
        disabled={isActive || isAutoRunning}
        title={!isCameraConnected ? 'Camera not connected' : !hasWorkingFolder ? 'No working folder selected' : (isActive || isAutoRunning) ? 'Capture in progress' : ''}
      >
        <span className="capture-ring"></span>
      </button>
    </div>
  );
}

interface PhotoboothControlsProps {
  // Sequence state
  sequenceState: string;
  currentCountdown: number;
  reviewCountdown: number;
  photosTaken: number;
  scrambleTick: number;
  isActive: boolean;
  isAutoRunning: boolean;
  isPaused: boolean;
  manualPhase: string;
  manualReviewCountdown: number;

  // Settings
  autoCount: number;

  // Connection state
  isCameraConnected: boolean;
  hasWorkingFolder: boolean;

  // Actions
  onIntervalUp: () => void;
  onIntervalDown: () => void;
  onToggleActive: () => void;
  onPause: () => void;
  onStopIfActive: () => void;
  onCaptureNow: () => void;
  onCaptureStart?: () => void;  // Called when capture is initiated
  onShowNoCameraWarning: () => void;
  onShowNoWorkingFolderWarning: () => void;

  // Helpers
  getScrambledDigit: (offset: number, stopTick: number) => number;
}

export const PhotoboothControls = memo(function PhotoboothControls({
  sequenceState,
  currentCountdown,
  reviewCountdown,
  photosTaken,
  scrambleTick,
  isActive,
  isAutoRunning,
  isPaused,
  manualPhase,
  manualReviewCountdown,
  autoCount,
  isCameraConnected,
  hasWorkingFolder,
  onIntervalUp,
  onIntervalDown,
  onToggleActive,
  onPause,
  onStopIfActive,
  onCaptureNow,
  onShowNoCameraWarning,
  onShowNoWorkingFolderWarning,
  getScrambledDigit,
}: PhotoboothControlsProps) {
  return (
    <div className="controls-panel">
      <div className="controls-chassis">
        <DisplayStrip
          sequenceState={sequenceState}
          currentCountdown={currentCountdown}
          reviewCountdown={reviewCountdown}
          photosTaken={photosTaken}
          autoCount={autoCount}
          scrambleTick={scrambleTick}
          manualPhase={manualPhase}
          manualReviewCountdown={manualReviewCountdown}
          getScrambledDigit={getScrambledDigit}
        />

        <LEDBar isAutoRunning={isAutoRunning} isPaused={isPaused} />

        <ControlButtons
          onIntervalUp={onIntervalUp}
          onIntervalDown={onIntervalDown}
          isActive={isActive}
          isAutoRunning={isAutoRunning}
          isPaused={isPaused}
          isCameraConnected={isCameraConnected}
          hasWorkingFolder={hasWorkingFolder}
          onToggleActive={onToggleActive}
          onPause={onPause}
          onStopIfActive={onStopIfActive}
          onCaptureNow={onCaptureNow}
          onShowNoCameraWarning={onShowNoCameraWarning}
          onShowNoWorkingFolderWarning={onShowNoWorkingFolderWarning}
        />
      </div>

      <div className="chassis-label">
        <span className="label-model">IPH-2025</span>
        <span className="label-type">PHOTOBOOTH CONTROLLER</span>
      </div>
    </div>
  );
});

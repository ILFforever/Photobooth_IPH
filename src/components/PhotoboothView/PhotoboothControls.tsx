import { memo } from "react";

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

interface DisplayStripProps {
  sequenceState: string;
  currentCountdown: number;
  reviewCountdown: number;
  photosTaken: number;
  autoCount: number;
  scrambleTick: number;
  getScrambledDigit: (offset: number, stopTick: number) => number;
}

function DisplayStrip({
  sequenceState,
  currentCountdown,
  reviewCountdown,
  photosTaken,
  autoCount,
  scrambleTick,
  getScrambledDigit,
}: DisplayStripProps) {
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
          {sequenceState === 'review' ? 'REVIEW' : 'INT'}
        </div>
        <div className={`seven-segment-display ${sequenceState === 'review' ? 'yellow-mode' : ''}`}>
          {sequenceState === 'photoConfirm' || sequenceState === 'preCountdown' || sequenceState === 'betweenPhotos' ? (
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
  isActive: boolean;
  isPaused: boolean;
}

function LEDBar({ isActive, isPaused }: LEDBarProps) {
  return (
    <div className="led-bar">
      <div className={`led led-power ${isActive || isPaused ? 'led-on' : ''}`}>
        <span className="led-lens"></span>
        <span className="led-label">PWR</span>
      </div>
      <div className={`led led-run ${isActive && !isPaused ? 'led-on' : ''}`}>
        <span className="led-lens"></span>
        <span className="led-label">RUN</span>
      </div>
    </div>
  );
}

interface ControlButtonsProps {
  delayBetweenPhotos: number;
  setDelayBetweenPhotos: (value: number) => void;
  isActive: boolean;
  isPaused: boolean;
  isCameraConnected: boolean;
  hasWorkingFolder: boolean;
  onToggleActive: () => void;
  onPause: () => void;
  onStopIfActive: () => void;
  onCaptureNow: () => void;
  onShowNoCameraWarning: () => void;
}

function ControlButtons({
  delayBetweenPhotos,
  setDelayBetweenPhotos,
  isActive,
  isPaused,
  isCameraConnected,
  hasWorkingFolder,
  onToggleActive,
  onPause,
  onStopIfActive,
  onCaptureNow,
  onShowNoCameraWarning,
}: ControlButtonsProps) {
  const canStartAuto = isCameraConnected && hasWorkingFolder;

  const handleCaptureClick = () => {
    console.log('[PhotoboothControls] Capture button clicked, isActive:', isActive);
    if (!isCameraConnected) {
      onShowNoCameraWarning();
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
          <button className="ctrl-btn" onClick={() => setDelayBetweenPhotos(Math.min(10, delayBetweenPhotos + 1))}>
            <span>▲</span>
          </button>
          <button className="ctrl-btn" onClick={() => setDelayBetweenPhotos(Math.max(1, delayBetweenPhotos - 1))}>
            <span>▼</span>
          </button>
        </div>
      </div>

      <div className="control-group">
        <div className="control-label">TRANSPORT</div>
        <div className="button-row">
          <button
            className={`ctrl-btn ${!isActive ? 'auto-idle' : 'auto-running'}`}
            onClick={onToggleActive}
            disabled={!isActive && !canStartAuto}
            title={!canStartAuto ? (!isCameraConnected ? 'Camera not connected' : 'No working folder selected') : ''}
          >
            <span>{isActive ? '■' : '▶'}</span>
            <span className="btn-label">{isActive ? 'STOP' : 'AUTO'}</span>
          </button>
          <button
            className={`ctrl-btn ${isPaused ? 'hold-active' : ''}`}
            onClick={onPause}
            disabled={!isActive}
          >
            <span>⏸</span>
            <span className="btn-label">HOLD</span>
          </button>
        </div>
      </div>

      <button
        className="capture-btn"
        onClick={handleCaptureClick}
        title={!isCameraConnected ? 'Camera not connected' : ''}
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
  isPaused: boolean;

  // Settings
  delayBetweenPhotos: number;
  autoCount: number;

  // Connection state
  isCameraConnected: boolean;
  hasWorkingFolder: boolean;

  // Actions
  setDelayBetweenPhotos: (value: number) => void;
  onToggleActive: () => void;
  onPause: () => void;
  onStopIfActive: () => void;
  onCaptureNow: () => void;
  onShowNoCameraWarning: () => void;

  // Helpers
  getScrambledDigit: (offset: number, stopTick: number) => number;
}

export function PhotoboothControls({
  sequenceState,
  currentCountdown,
  reviewCountdown,
  photosTaken,
  scrambleTick,
  isActive,
  isPaused,
  delayBetweenPhotos,
  autoCount,
  isCameraConnected,
  hasWorkingFolder,
  setDelayBetweenPhotos,
  onToggleActive,
  onPause,
  onStopIfActive,
  onCaptureNow,
  onShowNoCameraWarning,
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
          getScrambledDigit={getScrambledDigit}
        />

        <LEDBar isActive={isActive} isPaused={isPaused} />

        <ControlButtons
          delayBetweenPhotos={delayBetweenPhotos}
          setDelayBetweenPhotos={setDelayBetweenPhotos}
          isActive={isActive}
          isPaused={isPaused}
          isCameraConnected={isCameraConnected}
          hasWorkingFolder={hasWorkingFolder}
          onToggleActive={onToggleActive}
          onPause={onPause}
          onStopIfActive={onStopIfActive}
          onCaptureNow={onCaptureNow}
          onShowNoCameraWarning={onShowNoCameraWarning}
        />
      </div>

      <div className="chassis-label">
        <span className="label-model">IPH-2025</span>
        <span className="label-type">PHOTOBOOTH CONTROLLER</span>
      </div>
    </div>
  );
}

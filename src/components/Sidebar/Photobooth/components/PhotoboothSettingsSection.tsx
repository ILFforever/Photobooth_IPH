import { ChevronDown, ChevronRight } from 'lucide-react';
import * as Slider from '@radix-ui/react-slider';

interface PhotoboothSettingsSectionProps {
  expanded: boolean;
  onToggle: () => void;
  autoCount: number;
  timerDelay: number;
  delayBetweenPhotos: number;
  photoReviewTime: number;
  onAutoCountChange: (value: number) => void;
  onTimerDelayChange: (value: number) => void;
  onDelayBetweenPhotosChange: (value: number) => void;
  onPhotoReviewTimeChange: (value: number) => void;
}

export function PhotoboothSettingsSection({
  expanded,
  onToggle,
  autoCount,
  timerDelay,
  delayBetweenPhotos,
  photoReviewTime,
  onAutoCountChange,
  onTimerDelayChange,
  onDelayBetweenPhotosChange,
  onPhotoReviewTimeChange,
}: PhotoboothSettingsSectionProps) {
  return (
    <div className="collapsible-section">
      <button
        className="collapsible-header"
        onClick={onToggle}
      >
        <div className="collapsible-header-left">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="collapsible-title">Photobooth Settings</span>
        </div>
      </button>
      {expanded && (
        <div className="collapsible-content">
          {/* Photo Count Slider */}
          <div className="slider-setting">
            <div className="slider-header">
              <span className="slider-label">Photo Count</span>
              <span className="slider-value">{autoCount}</span>
            </div>
            <div className="slider-wrapper">
              <div className="slider-track-container">
                <div className="slider-numbers-container">
                  <div
                    className="slider-active-indicator"
                    style={{
                      left: `${((autoCount - 1) / 9) * 100}%`,
                      width: '30px',
                      transform: 'translateX(-50%)'
                    }}
                  />
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((num) => (
                    <span
                      key={num}
                      className={`slider-number-marker ${num === autoCount ? 'active' : ''}`}
                      style={{
                        left: `${((num - 1) / 9) * 100}%`
                      }}
                    >
                      {num}
                    </span>
                  ))}
                </div>
              </div>
              <Slider.Root
                className="photobooth-slider"
                value={[autoCount]}
                onValueChange={(value) => onAutoCountChange(value[0])}
                min={1}
                max={10}
                step={1}
              >
                <Slider.Thumb className="photobooth-slider-thumb" />
              </Slider.Root>
            </div>
          </div>

          {/* Timer Delay Slider - Delay before 1st photo */}
          <div className="slider-setting">
            <div className="slider-header">
              <span className="slider-label">Delay Before 1st Photo</span>
              <span className="slider-value">{timerDelay}s</span>
            </div>
            <div className="slider-wrapper">
              <div className="slider-track-container">
                <div className="slider-numbers-container">
                  <div
                    className="slider-active-indicator"
                    style={{
                      left: `${((timerDelay - 1) / 14) * 100}%`,
                      width: '20px',
                      transform: 'translateX(-50%)'
                    }}
                  />
                  {Array.from({ length: 15 }, (_, i) => i + 1).map((num) => (
                    <span
                      key={num}
                      className={`slider-number-marker ${num === timerDelay ? 'active' : ''}`}
                      style={{
                        left: `${((num - 1) / 14) * 100}%`
                      }}
                    >
                      {num}
                    </span>
                  ))}
                </div>
              </div>
              <Slider.Root
                className="photobooth-slider"
                value={[timerDelay]}
                onValueChange={(value) => onTimerDelayChange(value[0])}
                min={1}
                max={15}
                step={1}
              >
                <Slider.Thumb className="photobooth-slider-thumb" />
              </Slider.Root>
            </div>
          </div>

          {/* Delay Between Photos Slider */}
          <div className="slider-setting">
            <div className="slider-header">
              <span className="slider-label">Delay Between Photos</span>
              <span className="slider-value">{delayBetweenPhotos}s</span>
            </div>
            <div className="slider-wrapper">
              <div className="slider-track-container">
                <div className="slider-numbers-container">
                  <div
                    className="slider-active-indicator"
                    style={{
                      left: `${((delayBetweenPhotos - 1) / 9) * 100}%`,
                      width: '20px',
                      transform: 'translateX(-50%)'
                    }}
                  />
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((num) => (
                    <span
                      key={num}
                      className={`slider-number-marker ${num === delayBetweenPhotos ? 'active' : ''}`}
                      style={{
                        left: `${((num - 1) / 9) * 100}%`
                      }}
                    >
                      {num}
                    </span>
                  ))}
                </div>
              </div>
              <Slider.Root
                className="photobooth-slider"
                value={[delayBetweenPhotos]}
                onValueChange={(value) => onDelayBetweenPhotosChange(value[0])}
                min={1}
                max={10}
                step={1}
              >
                <Slider.Thumb className="photobooth-slider-thumb" />
              </Slider.Root>
            </div>
          </div>

          {/* Photo Review Time Slider */}
          <div className="slider-setting">
            <div className="slider-header">
              <span className="slider-label">Photo Review Time</span>
              <span className="slider-value">{photoReviewTime}s</span>
            </div>
            <div className="slider-wrapper">
              <div className="slider-track-container">
                <div className="slider-numbers-container">
                  <div
                    className="slider-active-indicator"
                    style={{
                      left: `${((photoReviewTime - 1) / 9) * 100}%`,
                      width: '20px',
                      transform: 'translateX(-50%)'
                    }}
                  />
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((num) => (
                    <span
                      key={num}
                      className={`slider-number-marker ${num === photoReviewTime ? 'active' : ''}`}
                      style={{
                        left: `${((num - 1) / 9) * 100}%`
                      }}
                    >
                      {num}
                    </span>
                  ))}
                </div>
              </div>
              <Slider.Root
                className="photobooth-slider"
                value={[photoReviewTime]}
                onValueChange={(value) => onPhotoReviewTimeChange(value[0])}
                min={1}
                max={10}
                step={1}
              >
                <Slider.Thumb className="photobooth-slider-thumb" />
              </Slider.Root>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

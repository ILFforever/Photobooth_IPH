import { memo } from "react";
import { Image as ImageIcon, ExternalLink } from "lucide-react";
import type { DisplayMode, DisplayPreset, CurrentSetPhoto } from "./photoboothWorkspaceTypes";

interface GuestDisplayHeaderProps {
  displayMode: DisplayMode;
  sliderStyles: { left: number; width: number } | null;
  isSecondScreenOpen: boolean;
  currentSetPhotos: CurrentSetPhoto[];
  selectedPhotoIndex: number | null;
  centerBrowseIndex: number | null;
  onModeChange: (mode: DisplayMode) => void;
  onToggleSecondScreen: () => void;
  displayPresets: DisplayPreset[];
  tabRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>;
}

export default memo(function GuestDisplayHeader({
  displayMode,
  sliderStyles,
  isSecondScreenOpen,
  onModeChange,
  onToggleSecondScreen,
  displayPresets,
  tabRefs,
}: GuestDisplayHeaderProps) {
  return (
    <div className="preview-header">
      <div className="preview-title">
        <ImageIcon size={18} />
        <span>Guest Display</span>
      </div>
      <div className="preview-header-right">
        {/* Compact Mode Selector */}
        <div className="mode-selector-compact">
          {sliderStyles && (
            <div
              className="mode-selector-indicator"
              style={{
                left: sliderStyles.left,
                width: sliderStyles.width,
              }}
            />
          )}
          {displayPresets.map((preset) => (
            <button
              key={preset.id}
              ref={(el) => { tabRefs.current[preset.id] = el; }}
              className={`mode-tab-compact ${displayMode === preset.id ? 'active' : ''}`}
              onClick={() => onModeChange(preset.id)}
              title={preset.description}
            >
              <preset.icon size={16} />
            </button>
          ))}
        </div>
        <button
          className={`open-display-btn ${isSecondScreenOpen ? 'active' : ''}`}
          onClick={onToggleSecondScreen}
          title={isSecondScreenOpen ? "Close second screen" : "Open on second screen"}
        >
          <ExternalLink size={16} />
          <span>{isSecondScreenOpen ? 'Close Second Screen' : 'Open on Second Screen'}</span>
        </button>
      </div>
    </div>
  );
});

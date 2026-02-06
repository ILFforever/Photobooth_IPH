import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import "./PhotoboothSidebar.css";

interface ImageQualityProps {
  isExpanded: boolean;
  onToggle: () => void;
  cameraConnected?: boolean;
}

export function ImageQuality({ isExpanded, onToggle, cameraConnected = true }: ImageQualityProps) {
  const [activeSetting, setActiveSetting] = useState<string | null>(null);

  const settings = [
    { label: "FORMAT", value: "RAW", options: ["RAW", "JPEG", "RAW+JPEG"] },
    { label: "QUALITY", value: "Fine", options: ["Fine", "Normal", "Basic"] },
    { label: "ASPECT RATIO", value: "3:2", options: ["3:2", "4:3", "16:9", "1:1"] },
    { label: "RAW COMPRESS", value: "Lossless", options: ["Uncompressed", "Lossless", "Compressed"] },
    { label: "COLOR SPACE", value: "sRGB", options: ["sRGB", "Adobe RGB", "ProPhoto RGB"] },
  ];

  const [settingValues, setSettingValues] = useState<Record<string, string>>(
    settings.reduce((acc, s) => ({ ...acc, [s.label]: s.value }), {})
  );

  const currentFormat = settingValues["FORMAT"];

  // Check if a setting should be disabled based on the current format
  const isSettingDisabled = (label: string) => {
    if (label === "QUALITY") {
      // QUALITY only applies when JPEG is involved
      return currentFormat === "RAW";
    }
    if (label === "RAW COMPRESS") {
      // RAW COMPRESS only applies when RAW is involved
      return currentFormat === "JPEG";
    }
    return false;
  };

  const toggleSetting = (label: string) => {
    if (isSettingDisabled(label)) return;
    setActiveSetting(prev => prev === label ? null : label);
  };

  const selectOption = (label: string, option: string) => {
    setSettingValues(prev => ({ ...prev, [label]: option }));
  };

  if (!cameraConnected) return null;

  return (
    <div className="collapsible-section">
      <button className="collapsible-header" onClick={onToggle}>
        <div className="collapsible-header-left">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          <span className="collapsible-title">Image Quality</span>
        </div>
      </button>
      {isExpanded && (
        <div className="collapsible-content">
          <div className="camera-control-panel">
            <div className="settings-grid">
              {settings.map((setting) => {
                const disabled = isSettingDisabled(setting.label);
                return (
                  <div
                    key={setting.label}
                    className={`setting-cell ${activeSetting === setting.label ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
                    onClick={() => toggleSetting(setting.label)}
                  >
                    <span className="setting-label">{setting.label}</span>
                    <span className="setting-value">
                      {settingValues[setting.label]} {activeSetting === setting.label && <ChevronUp size={12} className="setting-chevron" />}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Setting Control Panel */}
          {activeSetting && (
            <div className="setting-control-panel">
              <div className="setting-control-header">
                <span className="setting-control-title">{activeSetting}</span>
                <button
                  className="setting-control-close"
                  onClick={() => setActiveSetting(null)}
                >
                  <ChevronDown size={14} />
                </button>
              </div>
              <div className="setting-options-grid">
                {settings
                  .find(s => s.label === activeSetting)
                  ?.options.map((option) => (
                    <button
                      key={option}
                      className="setting-option-btn"
                      onClick={() => selectOption(activeSetting, option)}
                    >
                      {option}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

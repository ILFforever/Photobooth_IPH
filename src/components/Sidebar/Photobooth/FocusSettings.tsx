import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import "./PhotoboothSidebar.css";

interface FocusSettingsProps {
  isExpanded: boolean;
  onToggle: () => void;
}

export function FocusSettings({ isExpanded, onToggle }: FocusSettingsProps) {
  const [activeSetting, setActiveSetting] = useState<string | null>(null);

  const settings = [
    { label: "FOCUS MODE", value: "AF-C", options: ["AF-S", "AF-C", "MF"] },
    { label: "FOCUS AREA", value: "Wide", options: ["Wide", "Zone", "Center", "Flexible Spot"] },
    { label: "AF ILLUMINATOR", value: "Auto", options: ["Auto", "On", "Off"] },
    { label: "FACE/EYE AF", value: "On", options: ["On", "Off"] },
    { label: "AF TRANSITION", value: "5", options: ["1", "2", "3", "4", "5", "6", "7"] },
    { label: "AF SENSITIVITY", value: "3", options: ["1", "2", "3", "4", "5"] },
  ];

  const [settingValues, setSettingValues] = useState<Record<string, string>>(
    settings.reduce((acc, s) => ({ ...acc, [s.label]: s.value }), {})
  );

  const isSettingDisabled = (label: string) => {
    const focusMode = settingValues["FOCUS MODE"];
    if (label === "AF ILLUMINATOR" || label === "FACE/EYE AF" || label === "AF TRANSITION" || label === "AF SENSITIVITY") {
      return focusMode === "MF";
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

  return (
    <div className="collapsible-section">
      <button className="collapsible-header" onClick={onToggle}>
        <div className="collapsible-header-left">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          <span className="collapsible-title">Focus</span>
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

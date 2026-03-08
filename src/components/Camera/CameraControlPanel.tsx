import { Battery, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import "./CameraControlPanel.css";

interface Setting {
  label: string;
  value: string;
  options?: string[];
}

interface SettingsCategory {
  name: string;
  settings: Setting[];
}

const tetheringSettings: SettingsCategory[] = [
  {
    name: "Image Quality",
    settings: [
      { label: "FORMAT", value: "RAW", options: ["RAW", "JPEG", "RAW+JPEG"] },
      { label: "QUALITY", value: "Fine", options: ["Fine", "Normal", "Basic"] },
      { label: "IMG SIZE", value: "L", options: ["L", "M", "S", "M1", "M2", "S1", "S2"] },
      { label: "RAW COMPRESS", value: "Lossless", options: ["Uncompressed", "Lossless", "Compressed"] },
      { label: "COLOR SPACE", value: "sRGB", options: ["sRGB", "Adobe RGB", "ProPhoto RGB"] },
    ]
  },
  {
    name: "Color & Tone",
    settings: [
      { label: "WB", value: "Auto", options: ["Auto", "Daylight", "Cloudy", "Shade", "Tungsten", "Fluorescent", "Flash", "Custom", "Kelvin"] },
      { label: "WB SHIFT", value: "0,0", options: ["A1,M1", "A2,M2", "A3,M3", "A4,M4", "A5,M5", "B1,G1", "B2,G2", "B3,G3", "B4,G4", "B5,G5", "0,0"] },
      { label: "FILM SIM", value: "Provia", options: ["Provia", "Velvia", "Astia", "Classic Chrome", "Pro Neg Hi", "Pro Neg Std", "Classic Neg", "Eterna", "Bleach Bypass"] },
      { label: "GRAIN", value: "Off", options: ["Off", "Weak", "Strong"] },
      { label: "COLOR MODE", value: "F0", options: ["F0 (Standard)", "F1 (Portrait)", "F2 (a)", "F1b (C)"] },
      { label: "D-RANGE", value: "Auto", options: ["100%", "200%", "400%", "Auto", "V1", "V2"] },
      { label: "HIGHLIGHT", value: "0", options: ["-2", "-1", "0", "+1", "+2", "+3", "+4"] },
      { label: "SHADOW", value: "0", options: ["-2", "-1", "0", "+1", "+2"] },
    ]
  },
  {
    name: "Capture Settings",
    settings: [
      { label: "CAPTURE MODE", value: "Single", options: ["Single", "Continuous Low", "Continuous High", "Burst", "Timer"] },
      { label: "CAPTURE DELAY", value: "Off", options: ["Off", "2s", "5s", "10s", "12s"] },
      { label: "RELEASE MODE", value: "Single", options: ["Single", "Continuous L", "Continuous H"] },
      { label: "TIMER", value: "Off", options: ["Off", "2s", "5s", "10s"] },
      { label: "EXPOSURE DELAY", value: "Off", options: ["Off", "1s", "2s", "3s"] },
    ]
  },
  {
    name: "Focus Controls",
    settings: [
      { label: "FOCUS MODE", value: "AF-S", options: ["AF-S", "AF-C", "Manual"] },
      { label: "AF MODE", value: "Multi", options: ["Multi", "Zone", "Single Point", "Wide/Tracking"] },
      { label: "FOCUS METER", value: "Multi", options: ["Multi", "Spot", "Average"] },
      { label: "PRE-AF", value: "Off", options: ["Off", "On"] },
      { label: "INSTANT AF", value: "Off", options: ["Off", "On"] },
      { label: "FOCUS CHECK", value: "Off", options: ["Off", "On"] },
      { label: "EYE AF", value: "Off", options: ["Off", "On"] },
      { label: "FACE DETECT", value: "Off", options: ["Off", "On"] },
      { label: "IMAGE STABILIZER", value: "Continuous", options: ["Off", "Continuous", "Shooting Only", "Pan/Tilt Only"] },
    ]
  },
  {
    name: "Live View & Display",
    settings: [
      { label: "LV SIZE", value: "1920x1280", options: ["640x480", "1280x856", "1920x1280"] },
      { label: "LV QUALITY", value: "High", options: ["Low", "Medium", "High"] },
      { label: "FOCUS PEAKING", value: "Off", options: ["Off", "Low", "Medium", "High"] },
      { label: "EXP PREVIEW", value: "On", options: ["On", "Off"] },
      { label: "GRID", value: "Rule of Thirds", options: ["Off", "Rule of Thirds", "Grid", "Spiral", "Center"] },
      { label: "ZOOM FOCUS", value: "Off", options: ["Off", "x3", "x5", "x10"] },
      { label: "INFO DISPLAY", value: "Clean", options: ["Clean", "Detailed", "Histogram", "Level"] },
    ]
  },
  {
    name: "Tethering Options",
    settings: [
      { label: "SAVE DEST", value: "Computer", options: ["Computer", "Camera SD", "Both"] },
      { label: "AUTO DOWNLOAD", value: "On", options: ["On", "Off"] },
      { label: "SHOW PREVIEW", value: "On", options: ["On", "Off"] },
      { label: "NAMING", value: "IMG", options: ["IMG_####", "Date/Time", "Custom Prefix", "Sequence"] },
      { label: "BACKUP LOC", value: "None", options: ["None", "Secondary Folder", "Network Drive"] },
      { label: "PRIORITY", value: "RAW First", options: ["RAW First", "JPEG First"] },
    ]
  },
  {
    name: "Camera Behavior",
    settings: [
      { label: "AUTO POWER", value: "5min", options: ["1min", "2min", "5min", "15min", "Off"] },
      { label: "SILENT MODE", value: "Off", options: ["Off", "On"] },
      { label: "AE/AF LOCK", value: "Separate", options: ["Separate", "Linked"] },
      { label: "FUNC LOCK", value: "Off", options: ["Off", "On"] },
      { label: "LOCK BTN MODE", value: "Hold", options: ["Hold", "Toggle"] },
    ]
  },
  {
    name: "Video Settings",
    settings: [
      { label: "MOVIE ISO", value: "Auto", options: ["Auto", "100", "200", "400", "800", "1600", "3200", "6400"] },
      { label: "MOVIE EXP", value: "Manual", options: ["Auto", "Manual"] },
    ]
  },
];

interface CameraControlPanelProps {
  children?: React.ReactNode;
  belowDivider?: React.ReactNode;
}

export default function CameraControlPanel({ children, belowDivider }: CameraControlPanelProps) {
  const [settings, setSettings] = useState<SettingsCategory[]>(tetheringSettings);
  const [expandedPanel, setExpandedPanel] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<string[]>(["Exposure Controls", "Capture Settings"]);

  const togglePanel = (label: string) => {
    setExpandedPanel(expandedPanel === label ? null : label);
  };

  const toggleCategory = (categoryName: string) => {
    setExpandedCategories((prev: string[]) => {
      if (prev.includes(categoryName)) {
        return prev.filter(c => c !== categoryName);
      } else {
        return [...prev, categoryName];
      }
    });
  };

  const selectOption = (categoryName: string, label: string, option: string) => {
    setSettings(settings.map(category => {
      if (category.name === categoryName) {
        return {
          ...category,
          settings: category.settings.map(s => s.label === label ? { ...s, value: option } : s)
        };
      }
      return category;
    }));
    setExpandedPanel(null);
  };

  const isCategoryExpanded = (categoryName: string): boolean => {
    return expandedCategories.includes(categoryName);
  };

  return (
    <div className="camera-control-wrapper">
      {children}
      <div className="camera-header">
        <div className="camera-name">
          <span>Canon EOS 5D Mark IV</span>
          <ChevronDown size={14} className="chevron-icon" />
        </div>
        <button className="disconnect-btn">Disconnect</button>
      </div>
      <div className="lens-info">EF50mm 1/1.8 II</div>
      <div className="camera-control-panel">
        <div className="top-row">
          <span className="mode-indicator">M</span>
          <div className="right-group">
            <span className="percentage">100%</span>
            <Battery size={16} className="battery-icon" />
          </div>
        </div>
        {settings.map((category) => (
          <div key={category.name} className="settings-category">
            <div
              className={`category-header ${isCategoryExpanded(category.name) ? 'expanded' : ''}`}
              onClick={() => toggleCategory(category.name)}
            >
              <ChevronRight
                size={12}
                className={`category-chevron ${isCategoryExpanded(category.name) ? 'expanded' : ''}`}
              />
              <span className="category-name">{category.name}</span>
            </div>
            {isCategoryExpanded(category.name) && (
              <div className="settings-grid">
                {category.settings.map((setting) => (
                  <div
                    key={setting.label}
                    className={`setting-cell ${expandedPanel === setting.label ? 'expanded' : ''}`}
                  >
                    <div
                      className="setting-header"
                      onClick={() => togglePanel(setting.label)}
                    >
                      <span className="setting-label">{setting.label}</span>
                      <span className="setting-value">{setting.value}</span>
                    </div>
                    {setting.options && (
                      <div className={`setting-options ${expandedPanel === setting.label ? 'open' : 'closed'}`}>
                        {setting.options.map((option) => (
                          <div
                            key={option}
                            className="setting-option"
                            onClick={() => selectOption(category.name, setting.label, option)}
                          >
                            {option}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {belowDivider}
    </div>
  );
}

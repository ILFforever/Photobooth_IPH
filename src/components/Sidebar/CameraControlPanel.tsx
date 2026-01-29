import { Battery } from "lucide-react";
import "./CameraControlPanel.css";

interface CameraControlPanelProps {
  children?: React.ReactNode;
  belowDivider?: React.ReactNode;
}

export default function CameraControlPanel({ children, belowDivider }: CameraControlPanelProps) {
  return (
    <div className="camera-control-panel">
      {children}
      <div className="top-row">
        <span className="mode-indicator">M</span>
        <div className="right-group">
          <span className="percentage">100%</span>
          <Battery size={18} className="battery-icon" />
        </div>
      </div>
      <div className="camera-values">
        <span className="value-item"><span className="value-prefix">1/</span><span className="value-number">128</span></span>
        <span className="value-item"><span className="value-prefix">F</span><span className="value-number">Auto</span></span>
        <span className="value-item"><span className="value-prefix">ISO</span><span className="value-number">12800</span></span>
      </div>
      <div className="panel-divider" />
      <div className="bottom-section">
        <div className="left-side">
          <span className="exposure-value">+1.0</span>
          <div className="exposure-scale">
            <div className="scale-row">
              <div className="tick tick-short" />
              <div className="tick tick-short" />
              <div className="tick tick-tall" />
              <div className="tick tick-short" />
              <div className="tick tick-short" />
              <div className="tick tick-tall" />
              <div className="tick tick-short" />
              <div className="tick tick-short" />
              <div className="tick tick-tall" />
              <div className="tick tick-short" />
              <div className="tick tick-short" />
              <div className="tick tick-tall" />
              <div className="tick tick-short" />
              <div className="tick tick-short" />
              <div className="tick tick-tall" />
            </div>
          </div>
        </div>
        <div className="horizontal-spacer" />
        <div className="vertical-divider" />
        <div className="horizontal-spacer" />
        <div className="right-side">
          <div className="mock-square" />
        </div>
      </div>
      {belowDivider}
    </div>
  );
}

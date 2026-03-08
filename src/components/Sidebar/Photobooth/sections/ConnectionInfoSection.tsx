import {
  ChevronDown,
  ChevronRight,
  Camera,
  Usb,
  Cable,
  Fingerprint,
  ShieldCheck,
  Info,
  Pause,
  Play,
  Activity,
  HelpCircle
} from "lucide-react";
import { useCamera } from "../../../../contexts";
import "../PhotoboothSidebar.css";

type CollapsibleSection = 'connection' | 'polling';

interface ConnectionInfoSectionProps {
  expandedSections: Record<CollapsibleSection, boolean>;
  toggleSection: (section: CollapsibleSection) => void;
  selectedCamera?: {
    id: string;
    manufacturer: string;
    model: string;
    port: string;
    usb_version?: string;
    serial_number?: string;
    firmware?: string;
  } | null;
  lensInfo?: string | null;
}

export function ConnectionInfoSection({ expandedSections, toggleSection, selectedCamera }: ConnectionInfoSectionProps) {
  const { isPollingPaused, pausePolling, resumePolling } = useCamera();

  const handlePauseToggle = async () => {
    if (isPollingPaused) {
      await resumePolling();
    } else {
      await pausePolling();
    }
  };

  return (
    <>
      {/* Camera Info Section */}
      <div className="collapsible-section">
        <button
          className="collapsible-header"
          onClick={() => toggleSection('connection')}
        >
          <div className="collapsible-header-left">
            {expandedSections.connection ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="collapsible-title">Camera Info</span>
          </div>
        </button>
        {expandedSections.connection && (
          <div className="collapsible-content">
            <div className="connection-info-container">
              {!selectedCamera && (
                <div className="connection-info-empty">
                  <span>No camera connected</span>
                </div>
              )}
              {selectedCamera && (
                <>
                  <div className="connection-info-row">
                    <div className="connection-info-label">
                      <Info size={14} />
                      <span>Brand</span>
                    </div>
                    <div className="connection-info-value">
                      {selectedCamera.manufacturer}
                    </div>
                  </div>

                  <div className="connection-info-row">
                    <div className="connection-info-label">
                      <Camera size={14} />
                      <span>Model</span>
                    </div>
                    <div className="connection-info-value">
                      {selectedCamera.model}
                    </div>
                  </div>

                  <div className="connection-info-row">
                    <div className="connection-info-label">
                      <ShieldCheck size={14} />
                      <span>Firmware</span>
                    </div>
                    <div className="connection-info-value">
                      {selectedCamera.firmware || "---"}
                    </div>
                  </div>

                  <div className="connection-info-row">
                    <div className="connection-info-label">
                      <Fingerprint size={14} />
                      <span>Serial No.</span>
                    </div>
                    <div className="connection-info-value">
                      {selectedCamera.serial_number || "---"}
                    </div>
                  </div>

                  {/* USB Version */}
                  {selectedCamera.usb_version && (
                    <div className="connection-info-row">
                      <div className="connection-info-label">
                        <Usb size={14} />
                        <span>USB</span>
                      </div>
                      <div className="connection-info-value">{selectedCamera.usb_version}</div>
                    </div>
                  )}

                  {/* Port */}
                  {selectedCamera.port && (
                    <div className="connection-info-row">
                      <div className="connection-info-label">
                        <Cable size={14} />
                        <span>Port</span>
                      </div>
                      <div className="connection-info-value connection-info-port">{selectedCamera.port}</div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Camera Polling Section */}
      <div className="collapsible-section">
        <button
          className="collapsible-header"
          onClick={() => toggleSection('polling')}
        >
          <div className="collapsible-header-left">
            {expandedSections.polling ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="collapsible-title">Camera Polling</span>
            {isPollingPaused && (
              <span className="polling-status-badge paused">Paused</span>
            )}
          </div>
          <div className="collapsible-header-right">
            <Activity size={14} className={isPollingPaused ? "polling-icon-paused" : "polling-icon-active"} />
          </div>
        </button>
        {expandedSections.polling && (
          <div className="collapsible-content">
            <div className="polling-section-container">
              {/* Explanation */}
              <div className="polling-explanation">
                <HelpCircle size={14} />
                <div className="polling-explanation-text">
                  <p>Camera polling periodically checks the camera for settings changes and transfers captured photos. Pause to temporarily stop communication without disconnecting.</p>
                  <p><strong>Tip:</strong> When paused, you can use the camera's physical buttons to adjust settings directly on the device.</p>
                </div>
              </div>

              {/* Status indicator */}
              <div className={`polling-status-card ${isPollingPaused ? 'paused' : 'active'}`}>
                <div className="polling-status-indicator" />
                <span className="polling-status-text">
                  {isPollingPaused ? "Polling is paused — camera won't sync settings or transfer photos" : "Polling is active — camera communicating normally"}
                </span>
              </div>

              {/* Control Button */}
              <div className="polling-control-container">
                <button
                  className={`polling-toggle-btn ${isPollingPaused ? 'paused' : 'resumed'}`}
                  onClick={handlePauseToggle}
                  title={isPollingPaused ? "Resume camera polling" : "Pause camera polling"}
                >
                  {isPollingPaused ? <Play size={14} /> : <Pause size={14} />}
                  <span>{isPollingPaused ? "Resume Polling" : "Pause Polling"}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

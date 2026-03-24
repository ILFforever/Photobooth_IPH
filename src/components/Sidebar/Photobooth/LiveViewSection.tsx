import {
  ChevronDown,
  ChevronRight,
  HdmiPort,
  Usb,
  AlertTriangle,
  Info,
  X,
  RotateCw,
  Download,
  Settings2,
} from "lucide-react";
import "./LiveViewSection.css";
import { useState, useRef, useEffect } from "react";
import { FFmpegDownloadModal } from "../../Modals";
import { useLiveView } from "../../../contexts";
import { emit, listen } from "@tauri-apps/api/event";
import "../../../styles/Modal.css";

type CollapsibleSection =
  | "camera"
  | "liveview"
  | "folder"
  | "photobooth"
  | "naming";
type CaptureMethod = "hdmi" | "usbc";

interface LiveViewSectionProps {
  expandedSections: Record<CollapsibleSection, boolean>;
  toggleSection: (section: CollapsibleSection) => void;
}

export function LiveViewSection({
  expandedSections,
  toggleSection,
}: LiveViewSectionProps) {
  const { hdmi, ptp } = useLiveView();

  const [captureMethod, setCaptureMethod] = useState<CaptureMethod>("hdmi");
  const [showUsbWarning, setShowUsbWarning] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showFfmpegModal, setShowFfmpegModal] = useState(false);
  const [showDeviceDropdown, setShowDeviceDropdown] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });
  const [videoStretch, setVideoStretch] = useState(100);
  const [videoStretchV, setVideoStretchV] = useState(100);
  const [videoRotation, setVideoRotation] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggingV, setIsDraggingV] = useState(false);
  const [simpleScalingMode, setSimpleScalingMode] = useState(true);
  const dropdownButtonRef = useRef<HTMLButtonElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const sliderVRef = useRef<HTMLDivElement>(null);
  const ffmpegModalOpenRef = useRef(false);

  // Track modal open state with ref for immediate access in effects
  useEffect(() => {
    ffmpegModalOpenRef.current = showFfmpegModal;
  }, [showFfmpegModal]);

  // Load HDMI devices when switching to HDMI mode and poll for changes
  // Skip polling when FFmpeg modal is shown to prevent blipping
  useEffect(() => {
    if (captureMethod === "hdmi" && !showFfmpegModal) {
      // Clear any existing loading state to prevent blips
      hdmi.loadDevices();
      const interval = setInterval(() => {
        // Double-check modal state inside interval to prevent polling during modal
        if (!ffmpegModalOpenRef.current) {
          hdmi.loadDevices();
        }
      }, 1500);
      return () => clearInterval(interval);
    }
  }, [captureMethod, showFfmpegModal]);

  // Auto start HDMI capture (keep running even when collapsed)
  // Skip when FFmpeg modal is open to prevent interference
  useEffect(() => {
    if (showFfmpegModal) return;

    if (captureMethod === "hdmi" && hdmi.selectedDevice && !hdmi.isCapturing) {
      hdmi.startCapture(hdmi.selectedDevice);
    } else if (
      captureMethod === "hdmi" &&
      !hdmi.selectedDevice &&
      hdmi.isCapturing
    ) {
      hdmi.stopCapture();
    }
  }, [hdmi.selectedDevice, captureMethod, hdmi.isCapturing, showFfmpegModal]);

  // PTP streaming management for USB-C mode
  useEffect(() => {
    if (captureMethod === "usbc") {
      // Stop HDMI capture when in USB-C/PTP mode
      hdmi.stopCapture();
      // Start PTP streaming via context hook
      ptp.startStream();
    } else if (captureMethod === "hdmi") {
      // Stop PTP streaming when in HDMI mode
      ptp.stopStream();
    }

    // Cleanup: stop PTP streaming on unmount
    return () => {
      if (captureMethod === "usbc") {
        ptp.stopStream();
      }
    };
  }, [captureMethod, hdmi.stopCapture, ptp.startStream, ptp.stopStream]);

  const handleCaptureMethodChange = (method: CaptureMethod) => {
    if (method === "usbc" && captureMethod === "hdmi") {
      setShowUsbWarning(true);
    }
    setCaptureMethod(method);
    // Don't clear device selections - preserve settings across method switches
  };

  // Handle video stretch slider drag
  const handleSliderChange = (clientX: number) => {
    if (!sliderRef.current) return;

    const rect = sliderRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = x / rect.width;

    // Map 0-100% to stretch values (50% to 150%)
    const minStretch = 50;
    const maxStretch = 150;
    const newStretch = Math.round(
      minStretch + (maxStretch - minStretch) * percentage,
    );

    setVideoStretch(newStretch);
    document.documentElement.style.setProperty(
      "--video-stretch",
      (newStretch / 100).toString(),
    );
    broadcastVideoSettings(newStretch, videoStretchV, videoRotation);
  };

  // Combined slider handler for simple mode (scales both H and V together)
  const handleCombinedSliderChange = (clientX: number) => {
    if (!sliderRef.current) return;

    const rect = sliderRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = x / rect.width;

    // Map 0-100% to stretch values (50% to 150%)
    const minStretch = 50;
    const maxStretch = 150;
    const newStretch = Math.round(
      minStretch + (maxStretch - minStretch) * percentage,
    );

    // Update both horizontal and vertical stretch together
    setVideoStretch(newStretch);
    setVideoStretchV(newStretch);
    document.documentElement.style.setProperty(
      "--video-stretch",
      (newStretch / 100).toString(),
    );
    document.documentElement.style.setProperty(
      "--video-stretch-v",
      (newStretch / 100).toString(),
    );
    broadcastVideoSettings(newStretch, newStretch, videoRotation);
  };

  const handleSliderMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    handleSliderChange(e.clientX);

    const handleMouseMove = (e: MouseEvent) => handleSliderChange(e.clientX);
    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleCombinedSliderMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    handleCombinedSliderChange(e.clientX);

    const handleMouseMove = (e: MouseEvent) => handleCombinedSliderChange(e.clientX);
    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // Vertical stretch slider
  const handleSliderChangeV = (clientX: number) => {
    if (!sliderVRef.current) return;

    const rect = sliderVRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = x / rect.width;

    const minStretch = 50;
    const maxStretch = 150;
    const newStretch = Math.round(
      minStretch + (maxStretch - minStretch) * percentage,
    );

    setVideoStretchV(newStretch);
    document.documentElement.style.setProperty(
      "--video-stretch-v",
      (newStretch / 100).toString(),
    );
    broadcastVideoSettings(videoStretch, newStretch, videoRotation);
  };

  const handleSliderMouseDownV = (e: React.MouseEvent) => {
    setIsDraggingV(true);
    handleSliderChangeV(e.clientX);

    const handleMouseMove = (e: MouseEvent) => handleSliderChangeV(e.clientX);
    const handleMouseUp = () => {
      setIsDraggingV(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // Broadcast video settings to guest display window
  const broadcastVideoSettings = (
    stretch: number,
    stretchV: number,
    rotation: number,
  ) => {
    emit("guest-display:video-settings", {
      stretch: stretch / 100,
      stretchV: stretchV / 100,
      rotation,
    });
  };

  const handleRotationChange = (degrees: number) => {
    setVideoRotation(degrees);
    document.documentElement.style.setProperty(
      "--video-rotate",
      `${degrees}deg`,
    );
    broadcastVideoSettings(videoStretch, videoStretchV, degrees);
  };

  // Refs for guest-display:ready handler (avoids stale closures)
  const videoStretchRef = useRef(videoStretch);
  videoStretchRef.current = videoStretch;
  const videoStretchVRef = useRef(videoStretchV);
  videoStretchVRef.current = videoStretchV;
  const videoRotationRef = useRef(videoRotation);
  videoRotationRef.current = videoRotation;

  // Initialize CSS variables on mount + re-send when guest display opens
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--video-stretch",
      (videoStretch / 100).toString(),
    );
    document.documentElement.style.setProperty(
      "--video-stretch-v",
      (videoStretchV / 100).toString(),
    );
    document.documentElement.style.setProperty(
      "--video-rotate",
      `${videoRotation}deg`,
    );
    broadcastVideoSettings(videoStretch, videoStretchV, videoRotation);

    let unlisten: (() => void) | null = null;
    listen("guest-display:ready", () => {
      broadcastVideoSettings(
        videoStretchRef.current,
        videoStretchVRef.current,
        videoRotationRef.current,
      );
    }).then((u) => {
      unlisten = u;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (showDeviceDropdown && dropdownButtonRef.current) {
      const rect = dropdownButtonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  }, [showDeviceDropdown]);

  return (
    <div className="collapsible-section">
      <button
        className="collapsible-header"
        onClick={() => toggleSection("liveview")}
      >
        <div className="collapsible-header-left">
          {expandedSections.liveview ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )}
          <span className="collapsible-title">Live View</span>
        </div>
      </button>
      {expandedSections.liveview && (
        <div className="collapsible-content">
          <div className="liveview-container">
            <div className="liveview-frame">
              {captureMethod === "hdmi" && hdmi.frameUrl ? (
                <img
                  src={hdmi.frameUrl}
                  className="liveview-video"
                  alt="HDMI Live View"
                />
              ) : captureMethod === "usbc" && ptp.frameUrl ? (
                <img
                  src={ptp.frameUrl}
                  className="liveview-video"
                  alt="PTP Live Stream"
                />
              ) : captureMethod === "usbc" && ptp.error ? (
                <div className="liveview-error">
                  <AlertTriangle size={24} />
                  <p>{ptp.error}</p>
                </div>
              ) : (
                <>
                  <div className="grid-line grid-line-h-1" />
                  <div className="grid-line grid-line-h-2" />
                  <div className="grid-line grid-line-v-1" />
                  <div className="grid-line grid-line-v-2" />
                </>
              )}
              <button
                className="liveview-info-btn"
                onClick={() => setShowInfoModal(true)}
                title="Learn about capture methods"
              >
                <Info size={14} />
              </button>
            </div>
          </div>

          {/* Capture Method Control */}
          <div className="liveview-controls">
            <div className="liveview-controls-header">
              <span className="liveview-controls-title">Capture Method</span>
            </div>

            <div className="capture-method-buttons">
              <button
                className={`capture-method-btn ${captureMethod === "hdmi" ? "active" : ""}`}
                onClick={() => handleCaptureMethodChange("hdmi")}
              >
                <HdmiPort size={16} />
                <span>HDMI Capture Card</span>
              </button>

              <button
                className={`capture-method-btn ${captureMethod === "usbc" ? "active" : ""}`}
                onClick={() => handleCaptureMethodChange("usbc")}
              >
                <Usb size={16} />
                <span>USB C (Daemon)</span>
              </button>
            </div>

            {captureMethod === "hdmi" && (
              <div className="capture-device-selector">
                <div className="device-selector-label">
                  Capture Device (FFmpeg)
                </div>
                {hdmi.isLoadingDevices ? (
                  <div className="device-loading">Loading devices...</div>
                ) : hdmi.error ? (
                  <div className={hdmi.ffmpegRequired ? "ffmpeg-toast" : "device-error"}>
                    {hdmi.ffmpegRequired ? (
                      <>
                        <div className="ffmpeg-toast-header">
                          <Download size={13} />
                          <span>FFmpeg Required</span>
                        </div>
                        <span className="ffmpeg-toast-message">
                          FFmpeg is needed for HDMI capture. Download it to get started.
                        </span>
                        <button
                          className="ffmpeg-toast-btn"
                          onClick={() => setShowFfmpegModal(true)}
                        >
                          <Download size={11} />
                          Download FFmpeg
                        </button>
                      </>
                    ) : (
                      <>
                        <span>{hdmi.error}</span>
                        <button
                          className="device-retry-btn"
                          onClick={() => hdmi.loadDevices()}
                        >
                          Retry
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="device-dropdown-wrapper">
                    <button
                      ref={dropdownButtonRef}
                      className="device-dropdown-button"
                      onClick={() => setShowDeviceDropdown(!showDeviceDropdown)}
                    >
                      <span className="device-dropdown-text">
                        {hdmi.selectedDevice || "Select capture device..."}
                      </span>
                      <ChevronDown
                        size={14}
                        className={`device-dropdown-icon ${showDeviceDropdown ? "open" : ""}`}
                      />
                    </button>
                    {showDeviceDropdown && (
                      <div
                        className="device-dropdown-menu"
                        style={{
                          top: `${dropdownPosition.top}px`,
                          left: `${dropdownPosition.left}px`,
                          width: `${dropdownPosition.width}px`,
                        }}
                      >
                        {hdmi.devices.length === 0 ? (
                          <div
                            className="device-dropdown-item"
                            style={{ cursor: "default", opacity: 0.7 }}
                          >
                            No devices found
                          </div>
                        ) : (
                          hdmi.devices.map((device) => (
                            <button
                              key={device.name}
                              className={`device-dropdown-item ${hdmi.selectedDevice === device.name ? "selected" : ""}`}
                              onClick={() => {
                                hdmi.setSelectedDevice(device.name);
                                setShowDeviceDropdown(false);
                              }}
                            >
                              {device.name}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {showUsbWarning && captureMethod === "usbc" && (
              <div className="usb-warning-banner">
                <AlertTriangle size={14} className="warning-icon" />
                <div className="warning-text">
                  <strong>Warning:</strong> USB C mode locks camera buttons due
                  to libgphoto2 limitations.
                </div>
              </div>
            )}

            {/* Video Stretch Sliders */}
            <div className="video-stretch-control">
              <div className="stretch-control-header">
                <span className="stretch-control-title">
                  {simpleScalingMode ? "Overall Scale" : "Scaling Controls"}
                </span>
                <button
                  className="scaling-mode-toggle"
                  onClick={() => setSimpleScalingMode(!simpleScalingMode)}
                  title={simpleScalingMode ? "Switch to advanced mode" : "Switch to simple mode"}
                >
                  <Settings2 size={14} />
                  <span>{simpleScalingMode ? "Advanced" : "Simple"}</span>
                </button>
              </div>

              {simpleScalingMode ? (
                // Simple mode: Single slider for both H and V
                <>
                  <div className="stretch-control-header">
                    <span className="stretch-control-subtitle">Scale</span>
                    <span className="stretch-control-value">{videoStretch}%</span>
                  </div>
                  <div
                    ref={sliderRef}
                    className={`stretch-slider ${isDragging ? "dragging" : ""}`}
                    onMouseDown={handleCombinedSliderMouseDown}
                  >
                    <div
                      className="stretch-slider-fill"
                      style={{ width: `${((videoStretch - 50) / 100) * 100}%` }}
                    />
                    <div
                      className="stretch-slider-thumb"
                      style={{ left: `${((videoStretch - 50) / 100) * 100}%` }}
                    />
                  </div>
                </>
              ) : (
                // Advanced mode: Separate H and V sliders
                <>
                  <div className="stretch-control-header">
                    <span className="stretch-control-subtitle">Horizontal Stretch</span>
                    <span className="stretch-control-value">{videoStretch}%</span>
                  </div>
                  <div
                    ref={sliderRef}
                    className={`stretch-slider ${isDragging ? "dragging" : ""}`}
                    onMouseDown={handleSliderMouseDown}
                  >
                    <div
                      className="stretch-slider-fill"
                      style={{ width: `${((videoStretch - 50) / 100) * 100}%` }}
                    />
                    <div
                      className="stretch-slider-thumb"
                      style={{ left: `${((videoStretch - 50) / 100) * 100}%` }}
                    />
                  </div>

                  <div className="stretch-control-header">
                    <span className="stretch-control-subtitle">Vertical Stretch</span>
                    <span className="stretch-control-value">{videoStretchV}%</span>
                  </div>
                  <div
                    ref={sliderVRef}
                    className={`stretch-slider ${isDraggingV ? "dragging" : ""}`}
                    onMouseDown={handleSliderMouseDownV}
                  >
                    <div
                      className="stretch-slider-fill"
                      style={{ width: `${((videoStretchV - 50) / 100) * 100}%` }}
                    />
                    <div
                      className="stretch-slider-thumb"
                      style={{ left: `${((videoStretchV - 50) / 100) * 100}%` }}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Rotation Control */}
            <div className="video-stretch-control">
              <div className="stretch-control-header">
                <span className="stretch-control-title">Rotation</span>
                <span className="stretch-control-value">{videoRotation}°</span>
              </div>
              <div className="rotation-buttons">
                {[0, 90, 180, 270].map((deg) => (
                  <button
                    key={deg}
                    className={`rotation-btn ${videoRotation === deg ? "active" : ""}`}
                    onClick={() => handleRotationChange(deg)}
                  >
                    <RotateCw
                      size={12}
                      style={{ transform: `rotate(${deg}deg)` }}
                    />
                    <span>{deg}°</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Info Modal */}
      {showInfoModal && (
        <div className="modal-overlay" onClick={() => setShowInfoModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Capture Methods</h3>
              <button
                className="modal-close"
                onClick={() => setShowInfoModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="capture-method-info">
                <div className="method-info-header">
                  <HdmiPort size={20} className="method-info-icon" />
                  <h4 className="method-info-title">HDMI Capture Card</h4>
                </div>
                <p className="method-info-description">
                  Uses an external HDMI capture card to display the camera's
                  live view output.
                </p>
                <ul className="method-info-features">
                  <li className="feature-pro">
                    ✓ No blocking - UI remains fully responsive
                  </li>
                  <li className="feature-pro">✓ Low latency display</li>
                  <li className="feature-con">
                    ✗ Requires additional hardware
                  </li>
                  <li className="feature-con">
                    ✗ Camera must support HDMI output
                  </li>
                </ul>
              </div>

              <div className="capture-method-info">
                <div className="method-info-header">
                  <Usb size={20} className="method-info-icon" />
                  <h4 className="method-info-title">USB C (PTP Streaming)</h4>
                </div>
                <p className="method-info-description">
                  Direct USB connection using continuous PTP streaming via
                  libgphoto2 daemon at 25 FPS.
                </p>
                <ul className="method-info-features">
                  <li className="feature-pro">
                    ✓ Only USB cable needed - no capture card
                  </li>
                  <li className="feature-pro">
                    ✓ Continuous streaming with auto pause/resume
                  </li>
                  <li className="feature-pro">
                    ✓ Works during capture and config changes
                  </li>
                  <li className="feature-con">
                    ✗ Locks camera buttons (libgphoto2 limitation)
                  </li>
                  <li className="feature-con">
                    ✗ Slightly higher latency (~15 FPS) vs HDMI
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* FFmpeg Download Modal */}
      {showFfmpegModal && (
        <FFmpegDownloadModal
          show={showFfmpegModal}
          onClose={() => setShowFfmpegModal(false)}
          onDownloadComplete={() => {
            setShowFfmpegModal(false);
            // Effect re-runs on showFfmpegModal change and calls loadDevices
          }}
        />
      )}
    </div>
  );
}

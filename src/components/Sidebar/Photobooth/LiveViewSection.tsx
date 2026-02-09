import { ChevronDown, ChevronRight, HdmiPort, Usb, AlertTriangle, Info, X } from "lucide-react";
import "./PhotoboothSidebar.css";
import { useState, useRef, useEffect, useCallback } from "react";
import { useLiveView } from "../../../contexts/LiveViewContext";

type CollapsibleSection = 'camera' | 'liveview' | 'folder' | 'photobooth' | 'naming';
type CaptureMethod = 'hdmi' | 'usbc';

interface LiveViewSectionProps {
  expandedSections: Record<CollapsibleSection, boolean>;
  toggleSection: (section: CollapsibleSection) => void;
}

export function LiveViewSection({ expandedSections, toggleSection }: LiveViewSectionProps) {
  const {
    stream: liveViewStream,
    selectedDeviceId: webrtcSelectedDeviceId,
    startStream,
    stopStream,
    hdmi,
  } = useLiveView();

  const [captureMethod, setCaptureMethod] = useState<CaptureMethod>('hdmi');
  const [showUsbWarning, setShowUsbWarning] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showDeviceDropdown, setShowDeviceDropdown] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const [videoStretch, setVideoStretch] = useState(100);
  const [videoStretchV, setVideoStretchV] = useState(100);
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggingV, setIsDraggingV] = useState(false);
  const dropdownButtonRef = useRef<HTMLButtonElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const sliderVRef = useRef<HTMLDivElement>(null);

  // Callback ref: attaches srcObject whenever the <video> DOM node mounts
  // (covers initial mount AND conditional re-mount when section collapses/expands)
  const liveViewStreamRef = useRef<MediaStream | null>(liveViewStream);
  liveViewStreamRef.current = liveViewStream;

  const videoCallbackRef = useCallback((node: HTMLVideoElement | null) => {
    if (node && liveViewStreamRef.current) {
      node.srcObject = liveViewStreamRef.current;
    }
  }, []);

  // Load HDMI devices when switching to HDMI mode
  useEffect(() => {
    console.log('[LiveViewSection] Device load effect — captureMethod:', captureMethod);
    if (captureMethod === 'hdmi') {
      hdmi.loadDevices();
    }
  }, [captureMethod]);

  // Auto start HDMI capture (keep running even when collapsed)
  useEffect(() => {
    console.log('[LiveViewSection] HDMI capture effect — captureMethod:', captureMethod, 'selectedDevice:', hdmi.selectedDevice);
    if (captureMethod === 'hdmi' && hdmi.selectedDevice && !hdmi.isCapturing) {
      console.log('[LiveViewSection] → Starting HDMI capture for:', hdmi.selectedDevice);
      hdmi.startCapture(hdmi.selectedDevice);
    } else if (captureMethod === 'hdmi' && !hdmi.selectedDevice && hdmi.isCapturing) {
      console.log('[LiveViewSection] → Stopping HDMI capture (no device selected)');
      hdmi.stopCapture();
    }
    // Stop getUserMedia stream when in HDMI mode
    if (captureMethod === 'hdmi') {
      stopStream();
    }
  }, [hdmi.selectedDevice, captureMethod, hdmi.isCapturing]);

  // Auto start getUserMedia stream for USB-C mode (keep running even when collapsed)
  useEffect(() => {
    if (webrtcSelectedDeviceId && captureMethod === 'usbc' && !liveViewStream) {
      startStream(webrtcSelectedDeviceId);
    } else if (captureMethod === 'usbc' && !webrtcSelectedDeviceId && liveViewStream) {
      stopStream();
    }
    // Stop HDMI capture when in USB-C mode
    if (captureMethod === 'usbc') {
      hdmi.stopCapture();
    }
  }, [webrtcSelectedDeviceId, captureMethod, liveViewStream, startStream, stopStream]);

  const handleCaptureMethodChange = (method: CaptureMethod) => {
    if (method === 'usbc' && captureMethod === 'hdmi') {
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
    const newStretch = Math.round(minStretch + (maxStretch - minStretch) * percentage);

    setVideoStretch(newStretch);

    // Update CSS custom property for video stretch
    document.documentElement.style.setProperty('--video-stretch', (newStretch / 100).toString());
  };

  const handleSliderMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    handleSliderChange(e.clientX);

    const handleMouseMove = (e: MouseEvent) => handleSliderChange(e.clientX);
    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Vertical stretch slider
  const handleSliderChangeV = (clientX: number) => {
    if (!sliderVRef.current) return;

    const rect = sliderVRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = x / rect.width;

    const minStretch = 50;
    const maxStretch = 150;
    const newStretch = Math.round(minStretch + (maxStretch - minStretch) * percentage);

    setVideoStretchV(newStretch);
    document.documentElement.style.setProperty('--video-stretch-v', (newStretch / 100).toString());
  };

  const handleSliderMouseDownV = (e: React.MouseEvent) => {
    setIsDraggingV(true);
    handleSliderChangeV(e.clientX);

    const handleMouseMove = (e: MouseEvent) => handleSliderChangeV(e.clientX);
    const handleMouseUp = () => {
      setIsDraggingV(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Initialize CSS variables on mount
  useEffect(() => {
    document.documentElement.style.setProperty('--video-stretch', (videoStretch / 100).toString());
    document.documentElement.style.setProperty('--video-stretch-v', (videoStretchV / 100).toString());
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
        onClick={() => toggleSection('liveview')}
      >
        <div className="collapsible-header-left">
          {expandedSections.liveview ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="collapsible-title">Live View</span>
        </div>
      </button>
      {expandedSections.liveview && (
        <div className="collapsible-content">
          <div className="liveview-container">
            <div className="liveview-frame">
              {captureMethod === 'hdmi' && hdmi.frameUrl ? (
                <img
                  src={hdmi.frameUrl}
                  className="liveview-video"
                  alt="HDMI Live View"
                />
              ) : captureMethod === 'usbc' && liveViewStream ? (
                <video
                  ref={videoCallbackRef}
                  autoPlay
                  playsInline
                  muted
                  className="liveview-video"
                />
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
                className={`capture-method-btn ${captureMethod === 'hdmi' ? 'active' : ''}`}
                onClick={() => handleCaptureMethodChange('hdmi')}
              >
                <HdmiPort size={16} />
                <span>HDMI Capture Card</span>
              </button>

              <button
                className={`capture-method-btn ${captureMethod === 'usbc' ? 'active' : ''}`}
                onClick={() => handleCaptureMethodChange('usbc')}
              >
                <Usb size={16} />
                <span>USB C (Daemon)</span>
              </button>
            </div>

            {captureMethod === 'hdmi' && (
              <div className="capture-device-selector">
                <div className="device-selector-label">Capture Device (FFmpeg)</div>
                {hdmi.isLoadingDevices ? (
                  <div className="device-loading">Loading devices...</div>
                ) : hdmi.error ? (
                  <div className="device-error">
                    <span>{hdmi.error}</span>
                    <button
                      className="device-retry-btn"
                      onClick={() => hdmi.loadDevices()}
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <div className="device-dropdown-wrapper">
                    <button
                      ref={dropdownButtonRef}
                      className="device-dropdown-button"
                      onClick={() => setShowDeviceDropdown(!showDeviceDropdown)}
                    >
                      <span className="device-dropdown-text">
                        {hdmi.selectedDevice || 'Select capture device...'}
                      </span>
                      <ChevronDown size={14} className={`device-dropdown-icon ${showDeviceDropdown ? 'open' : ''}`} />
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
                          <div className="device-dropdown-item" style={{ cursor: 'default', opacity: 0.7 }}>
                            No devices found
                          </div>
                        ) : (
                          hdmi.devices.map((device) => (
                            <button
                              key={device.name}
                              className={`device-dropdown-item ${hdmi.selectedDevice === device.name ? 'selected' : ''}`}
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

            {showUsbWarning && captureMethod === 'usbc' && (
              <div className="usb-warning-banner">
                <AlertTriangle size={14} className="warning-icon" />
                <div className="warning-text">
                  <strong>Warning:</strong> USB C mode locks camera buttons due to libgphoto2 limitations.
                </div>
              </div>
            )}

            {/* Video Stretch Sliders */}
            <div className="video-stretch-control">
              <div className="stretch-control-header">
                <span className="stretch-control-title">Horizontal Stretch</span>
                <span className="stretch-control-value">{videoStretch}%</span>
              </div>
              <div
                ref={sliderRef}
                className={`stretch-slider ${isDragging ? 'dragging' : ''}`}
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
            </div>

            <div className="video-stretch-control">
              <div className="stretch-control-header">
                <span className="stretch-control-title">Vertical Stretch</span>
                <span className="stretch-control-value">{videoStretchV}%</span>
              </div>
              <div
                ref={sliderVRef}
                className={`stretch-slider ${isDraggingV ? 'dragging' : ''}`}
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
                  Uses an external HDMI capture card to display the camera's live view output.
                </p>
                <ul className="method-info-features">
                  <li className="feature-pro">✓ No blocking - UI remains fully responsive</li>
                  <li className="feature-pro">✓ Low latency display</li>
                  <li className="feature-con">✗ Requires additional hardware</li>
                  <li className="feature-con">✗ Camera must support HDMI output</li>
                </ul>
              </div>

              <div className="capture-method-info">
                <div className="method-info-header">
                  <Usb size={20} className="method-info-icon" />
                  <h4 className="method-info-title">USB C (Daemon)</h4>
                </div>
                <p className="method-info-description">
                  Direct USB connection using libgphoto2 daemon to capture live view frames.
                </p>
                <ul className="method-info-features">
                  <li className="feature-pro">✓ Only type C cable needed</li>
                  <li className="feature-con">✗ Locks camera buttons (libgphoto2 limitation)</li>
                  <li className="feature-con">✗ Slightly higher latency compared to HDMI</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

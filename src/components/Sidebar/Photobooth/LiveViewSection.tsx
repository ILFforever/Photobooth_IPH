import { ChevronDown, ChevronRight, HdmiPort, Usb, AlertTriangle, Info, X } from "lucide-react";
import "./PhotoboothSidebar.css";
import { useState, useRef, useEffect } from "react";

type CollapsibleSection = 'camera' | 'liveview' | 'folder' | 'photobooth';
type CaptureMethod = 'hdmi' | 'usbc';

interface LiveViewSectionProps {
  expandedSections: Record<CollapsibleSection, boolean>;
  toggleSection: (section: CollapsibleSection) => void;
}

export function LiveViewSection({ expandedSections, toggleSection }: LiveViewSectionProps) {
  const [captureMethod, setCaptureMethod] = useState<CaptureMethod>('hdmi');
  const [showUsbWarning, setShowUsbWarning] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [selectedCaptureDevice, setSelectedCaptureDevice] = useState<string>('');
  const [showDeviceDropdown, setShowDeviceDropdown] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const [captureDevices, setCaptureDevices] = useState<Array<{ id: string; name: string }>>([]);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [isLoadingDevices, setIsLoadingDevices] = useState(true);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const dropdownButtonRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);

  // Load capture devices on mount
  useEffect(() => {
    const loadDevices = async () => {
      setIsLoadingDevices(true);
      setPermissionError(null);
      try {
        // Check if mediaDevices API is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
          throw new Error('MediaDevices API not supported');
        }

        // Request permission first to get device labels
        console.log('Requesting media permission...');
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        console.log('Permission granted, stopping initial stream...');

        // Stop the initial stream
        stream.getTracks().forEach(track => track.stop());

        // Enumerate devices
        console.log('Enumerating devices...');
        const devices = await navigator.mediaDevices.enumerateDevices();
        console.log('All devices:', devices);

        const videoDevices = devices
          .filter(device => device.kind === 'videoinput')
          .map(device => ({
            id: device.deviceId,
            name: device.label || `Camera ${device.deviceId.slice(0, 8)}`,
          }));

        console.log('Video devices found:', videoDevices);

        setCaptureDevices([
          { id: '', name: 'Select capture device...' },
          ...videoDevices,
        ]);

        if (videoDevices.length === 0) {
          setPermissionError('No video devices found');
        }
      } catch (error) {
        console.error('Error accessing media devices:', error);
        if (error instanceof Error) {
          setPermissionError(error.message);
        } else {
          setPermissionError('Failed to access camera devices');
        }
      } finally {
        setIsLoadingDevices(false);
      }
    };

    loadDevices();

    // Listen for device changes
    const handleDeviceChange = () => {
      console.log('Device change detected, reloading...');
      loadDevices();
    };

    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange);

    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
    };
  }, []);

  // Start video stream when device is selected and panel is expanded
  useEffect(() => {
    if (selectedCaptureDevice && captureMethod === 'hdmi' && expandedSections.liveview) {
      const startVideo = async () => {
        try {
          console.log('[LiveView] Starting video stream for device:', selectedCaptureDevice);
          const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: selectedCaptureDevice } }
        });
        console.log('[LiveView] Stream obtained:', stream);
        console.log('[LiveView] Stream tracks:', stream.getTracks());
        console.log('[LiveView] Stream ID:', stream.id);

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          console.log('[LiveView] Video track:', videoTrack);
          console.log('[LiveView] Video track settings:', videoTrack.getSettings());
          console.log('[LiveView] Video track capabilities:', videoTrack.getCapabilities());
        }

        // Update both state and ref (video element will be attached in separate effect)
        videoStreamRef.current = stream;
        setVideoStream(stream);
      } catch (error) {
        console.error('[LiveView] Error starting video stream:', error);
      }
    };

      startVideo();

      // Cleanup function - uses ref to always get latest stream
      return () => {
        console.log('[LiveView] Cleaning up video stream');
        if (videoStreamRef.current) {
          videoStreamRef.current.getTracks().forEach(track => track.stop());
          videoStreamRef.current = null;
        }
      };
    } else {
      // Stop video stream when switching away from HDMI, no device selected, or panel collapsed
      console.log('[LiveView] Stopping video stream (method:', captureMethod, 'device:', selectedCaptureDevice, 'expanded:', expandedSections.liveview, ')');
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach(track => track.stop());
        videoStreamRef.current = null;
      }
      setVideoStream(null);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    }
  }, [selectedCaptureDevice, captureMethod, expandedSections.liveview]);

  // Separate effect to set video element when stream changes
  useEffect(() => {
    if (videoStream && videoRef.current) {
      console.log('[LiveView] Setting srcObject on video element (from stream effect)');
      videoRef.current.srcObject = videoStream;
      console.log('[LiveView] Video element currentSrc:', videoRef.current.currentSrc);
      console.log('[LiveView] Video element videoWidth:', videoRef.current.videoWidth);
      console.log('[LiveView] Video element videoHeight:', videoRef.current.videoHeight);

      videoRef.current.onloadedmetadata = () => {
        console.log('[LiveView] Video metadata loaded');
        console.log('[LiveView] Video dimensions:', videoRef.current?.videoWidth, 'x', videoRef.current?.videoHeight);
      };

      videoRef.current.onplay = () => {
        console.log('[LiveView] Video started playing');
      };
    }
  }, [videoStream]);

  const handleCaptureMethodChange = (method: CaptureMethod) => {
    if (method === 'usbc' && captureMethod === 'hdmi') {
      setShowUsbWarning(true);
    }
    setCaptureMethod(method);
    setSelectedCaptureDevice('');
  };

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
              {captureMethod === 'hdmi' && videoStream ? (
                <video
                  ref={videoRef}
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
                <div className="device-selector-label">Capture Device</div>
                {isLoadingDevices ? (
                  <div className="device-loading">Loading devices...</div>
                ) : permissionError ? (
                  <div className="device-error">
                    <span>{permissionError}</span>
                    <button
                      className="device-retry-btn"
                      onClick={() => window.location.reload()}
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
                        {selectedCaptureDevice
                          ? captureDevices.find(d => d.id === selectedCaptureDevice)?.name
                          : 'Select capture device...'}
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
                        {captureDevices.length === 1 ? (
                          <div className="device-dropdown-item" style={{ cursor: 'default', opacity: 0.7 }}>
                            No devices found
                          </div>
                        ) : (
                          captureDevices.map((device) => (
                            <button
                              key={device.id}
                              className={`device-dropdown-item ${selectedCaptureDevice === device.id ? 'selected' : ''}`}
                              onClick={() => {
                                setSelectedCaptureDevice(device.id);
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

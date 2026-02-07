import { ChevronDown, ChevronRight, ChevronUp, Camera, RefreshCw, Plug } from "lucide-react";
import Icon from '@mdi/react';
import * as Slider from "@radix-ui/react-slider";
import {
  mdiCameraMeteringMatrix,
  mdiCameraMeteringPartial,
  mdiCameraMeteringSpot,
  mdiCameraMeteringCenter,
  mdiUsb,
  mdiBattery,
  mdiBattery10,
  mdiBattery20,
  mdiBattery30,
  mdiBattery40,
  mdiBattery50,
  mdiBattery60,
  mdiBattery70,
  mdiBattery80,
  mdiBattery90,
  mdiBatteryAlert,
  mdiWhiteBalanceSunny,
  mdiCloud ,
  mdiThermometer,
  mdiLightbulb,
  mdiWater,
  mdiNumeric1,
  mdiNumeric2,
  mdiNumeric3,
  mdiWhiteBalanceAuto,
  mdiFlower,
  mdiRefresh
} from '@mdi/js';
import { useState, useEffect, useRef } from "react";
import { useCamera } from "../../../contexts/CameraContext";
import { detectBrand, normalizeMode, isSettingAdjustable, type CameraBrand } from "../../../services/cameraBrands";
import { getCameraSettingsService } from "../../../services/cameraSettingsService";
import "./PhotoboothSidebar.css";

const API_BASE = 'http://localhost:58321';

// Get the global camera settings service
const cameraSettingsService = getCameraSettingsService();

interface CameraInfo {
  id: string;
  manufacturer: string;
  model: string;
  port: string;
  usb_version?: string;
}

// SVG Icons for Metering Modes
const MeteringIcons = {
  Evaluative: (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
      <path d="M9 2v7a6 6 0 006 6h6a6 6 0 006-6H9a6 6 0 00-6 6V2a6 6 0 016-6zM3 4a6 6 0 016 6v6a6 6 0 016 6h9a6 6 0 016-6v-6a6 6 0 00-6-6z" />
      <path d="M3 5a3 3 0 016 6v6a3 3 0 016-6h6a3 3 0 016 6V11a3 3 0 016-6h6a3 3 0 006-6v-6a3 3 0 00-6-6z" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="6" r="2" />
      <circle cx="12" cy="18" r="2" />
      <circle cx="6" cy="12" r="2" />
      <circle cx="18" cy="12" r="2" />
    </svg>
  ),
  Partial: (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
      <path d="M4 15h4v2h4v-2H4zm2-12h4v2H6V5h2v12h2zM2 4a2 2 0 014 2v12a2 2 0 01-2 2H8a2 2 0 01-2-2V6a2 2 0 012-2z" />
      <path d="M6 7v10a2 2 0 012 2v2a2 2 0 01-2 2h12a2 2 0 002-2v-2a2 2 0 00-2-2V7a2 2 0 00-2 2z" />
      <path d="M8 11h2v2H6v-2h2z" />
      <path d="M6 9h4v2H4v-2h2z" />
      <path d="M8 7h2v6H6v-6h2z" />
      <circle cx="12" cy="14" r="1.5" />
    </svg>
  ),
  Spot: (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 6l0 6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 12l6 0" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 12l-4 0" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 12l0 4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="1.5" stroke-dasharray="4 2" />
    </svg>
  ),
  CenterWeighted: (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1" />
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <path d="M12 2v20M12 4v16M12 8v8M2 12h20M8 12h8M12 12v-4" stroke="currentColor" strokeWidth="1" />
    </svg>
  ),
  Average: (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="6" r="2" />
      <circle cx="12" cy="18" r="2" />
      <circle cx="6" cy="12" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M16 8l-4 4M8 16l4-4" stroke="currentColor" strokeWidth="1" />
    </svg>
  ),
};

type SettingType = 'shutter' | 'aperture' | 'iso' | 'ev' | 'wb' | 'metering' | 'folder' | 'mode' | null;
type CollapsibleSection = 'camera' | 'liveview' | 'folder' | 'photobooth';

interface CameraSectionProps {
  expandedSections: Record<CollapsibleSection, boolean>;
  toggleSection: (section: CollapsibleSection) => void;
  shutterSpeeds: string[];
  apertureOptions: string[];
  isoOptions: string[];
  evOptions: string[];
  shutterValue: number;
  apertureIndex: number;
  isoIndex: number;
  evIndex: number;
  wbValue: string;
  meteringValue: string;
  activeSetting: SettingType;
  onToggleSetting: (setting: SettingType) => void;
  // User interaction handlers - send API commands and set pending state
  onSetShutterValue: (value: number) => void;
  onSetApertureIndex: (value: number) => void;
  onSetIsoIndex: (value: number) => void;
  onSetEvIndex: (value: number) => void;
  onSetWbValue: (value: string) => void;
  onSetMeteringValue: (value: string) => void;
  onSetActiveSetting: (setting: SettingType) => void;
  onCameraOptionsLoaded?: (options: { iso: string[]; aperture: string[]; shutterspeed: string[]; whitebalance: string[]; ev?: string[] }, skipStatusApply?: boolean, initialConfigValues?: { shutter?: string; aperture?: string; iso?: string; ev?: string; wb?: string; metering?: string; battery?: string }) => void;
  pendingSettings?: Record<string, string>;
  /** Callback when camera selection/connection state changes */
  onConnectionChange?: (isConnected: boolean, hasSelectedCamera: boolean) => void;
  /** Callback when initial config values are loaded (for setting dial positions) */
  onConfigValuesLoaded?: (values: { shutter?: string; aperture?: string; iso?: string; ev?: string; wb?: string; metering?: string; battery?: string }) => void;
}

export function CameraSection({
  expandedSections,
  toggleSection,
  shutterSpeeds,
  apertureOptions,
  isoOptions,
  evOptions,
  shutterValue,
  apertureIndex,
  isoIndex,
  evIndex,
  wbValue,
  meteringValue,
  activeSetting,
  onToggleSetting,
  onSetShutterValue,
  onSetApertureIndex,
  onSetIsoIndex,
  onSetEvIndex,
  onSetWbValue,
  onSetMeteringValue,
  onSetActiveSetting,
  onCameraOptionsLoaded,
  pendingSettings,
  onConnectionChange,
  onConfigValuesLoaded,
}: CameraSectionProps) {
  // Camera connection state
  const [availableCameras, setAvailableCameras] = useState<CameraInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<CameraInfo | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoadingCameras, setIsLoadingCameras] = useState(false);
  const [showCameraDropdown, setShowCameraDropdown] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<any>(null);
  const [lensInfo, setLensInfo] = useState<string | null>(null);
  const [cameraConfig, setCameraConfig] = useState<any>(null); // Stores config with choices
  const [cameraBrand, setCameraBrand] = useState<CameraBrand>(detectBrand('', '')); // Default to Fuji

  // Camera status from centralized WebSocket context
  const { batteryLevel, shootingMode, setConnecting, connect, disconnect, connectionState, setCameraHttpConnected } = useCamera();

  // Normalize shooting mode for display and logic using brand framework
  const normalizedMode = normalizeMode(shootingMode, cameraBrand);

  // Preview states for dragging - only send API on commit
  const [shutterPreview, setShutterPreview] = useState<number | null>(null);
  const [aperturePreview, setAperturePreview] = useState<number | null>(null);
  const [isoPreview, setIsoPreview] = useState<number | null>(null);
  const [evPreview, setEvPreview] = useState<number | null>(null);

  // Use preview value if available (during drag), otherwise use committed value
  const displayShutter = shutterPreview !== null ? shutterPreview : shutterValue;
  const displayAperture = aperturePreview !== null ? aperturePreview : apertureIndex;
  const displayIso = isoPreview !== null ? isoPreview : isoIndex;
  const displayEv = evPreview !== null ? evPreview : evIndex;

  // Camera setting options - populated from camera config
  const [cameraSettingOptions, setCameraSettingOptions] = useState<{
    iso: string[];
    aperture: string[];
    shutterspeed: string[];
    shutterspeed2: string[];
    whitebalance: string[];
    exposurecompensation: string[];
    ev?: string[]; // Brand-specific EV compensation (e.g., '5010' for Fuji, 'exposurecompensation' for Canon)
  }>({ iso: [], aperture: [], shutterspeed: [], shutterspeed2: [], whitebalance: [], exposurecompensation: [] });

  // Fetch available cameras on mount
  useEffect(() => {
    fetchCameras();
  }, []);

  // Clear preview states when parent values change (e.g., from WebSocket)
  useEffect(() => {
    setShutterPreview(null);
    setAperturePreview(null);
    setIsoPreview(null);
    setEvPreview(null);
  }, [shutterValue, apertureIndex, isoIndex, evIndex]);

  // Notify parent of connection state changes
  useEffect(() => {
    onConnectionChange?.(isConnected, selectedCamera !== null);
  }, [isConnected, selectedCamera, onConnectionChange]);

  // Reset local state when context disconnects (e.g. from ConnectionLostModal "Disconnect" button)
  useEffect(() => {
    if (connectionState === 'NC' && isConnected) {
      setSelectedCamera(null);
      setIsConnected(false);
      setCameraStatus(null);
      setLensInfo(null);
      setCameraConfig(null);
    }
  }, [connectionState, isConnected]);

  const fetchCameras = async () => {
    setIsLoadingCameras(true);
    try {
      const response = await fetch(`${API_BASE}/api/cameras`);
      if (response.ok) {
        const cameras = await response.json();
        setAvailableCameras(cameras);
      }
    } catch (error) {
      console.error('Error fetching cameras:', error);
    } finally {
      setIsLoadingCameras(false);
    }
  };

  const handleConnectCamera = async (camera: CameraInfo) => {
    setConnecting(true);
    setSelectedCamera(camera);
    setIsConnected(true);
    setShowCameraDropdown(false);
    setLensInfo(null);

    // Trigger connection state in context
    connect();

    // Detect camera brand for quirks handling
    const brand = detectBrand(camera.manufacturer, camera.model);
    setCameraBrand(brand);
    console.log(`Detected camera brand: ${brand.name} (id: ${brand.id})`);

    // Update the global camera settings service
    cameraSettingsService.setCamera(camera.id, camera.manufacturer, camera.model);

    // Tell controller to track this camera for polling/disconnect detection
    try {
      await fetch(`${API_BASE}/api/controller/switch?camera=${camera.id}`, { method: 'POST' });
      console.log(`Controller switched to camera ${camera.id}`);
    } catch (error) {
      console.warn('Failed to switch controller camera:', error);
    }

    // Fetch initial status and config
    try {
      const [statusResponse, configResponse] = await Promise.all([
        fetch(`${API_BASE}/api/camera/status?camera=${camera.id}`),
        fetch(`${API_BASE}/api/camera/config?camera=${camera.id}`)
      ]);

      if (statusResponse.ok) {
        const data = await statusResponse.json();
        setCameraStatus(data);
      }

      if (configResponse.ok) {
        const config = await configResponse.json();
        console.log('Config response:', JSON.stringify(config, null, 2));

        // Store full config for accessing choices
        setCameraConfig(config);

        // Extract setting choices from config
        // Note: Some cameras use 'f-number' instead of 'aperture' for the widget name
        const apertureConfig = config['f-number']?.choices || config.aperture?.choices || [];

        // Convert camera EV choices to display format using the service
        // Use brand-specific EV setting name (e.g., '5010' for Fuji, 'exposurecompensation' for Canon)
        const evSettingName = cameraSettingsService.getEvSettingName();
        let evChoices: string[] | undefined;
        if (config[evSettingName]?.choices && Array.isArray(config[evSettingName].choices)) {
          evChoices = cameraSettingsService.convertEvChoicesToDisplay(config[evSettingName].choices);
          console.log(`Converted ${evSettingName} EV choices:`, evChoices);
        }

        // Convert camera ISO choices to display format (e.g., "-1" -> "Auto 1" for Fuji)
        const isoChoices = config.iso?.choices || [];
        const convertedIsoChoices = cameraSettingsService.convertIsoChoicesToDisplay(isoChoices);
        console.log('Converted ISO choices:', convertedIsoChoices);

        // Extract current VALUES from config (the 'value' field of each setting)
        const initialValues: { shutter?: string; aperture?: string; iso?: string; ev?: string; wb?: string; metering?: string; battery?: string } = {};

        if (config.shutterspeed?.value) {
          initialValues.shutter = config.shutterspeed.value;
        }
        if (config['f-number']?.value) {
          initialValues.aperture = config['f-number'].value;
        } else if (config.aperture?.value) {
          initialValues.aperture = config.aperture.value;
        }
        if (config.iso?.value) {
          initialValues.iso = config.iso.value;
        }
        if (config[evSettingName]?.value) {
          initialValues.ev = config[evSettingName].value;
        }
        if (config.whitebalance?.value) {
          initialValues.wb = config.whitebalance.value;
        }
        if (config.exposuremetermode?.value) {
          initialValues.metering = config.exposuremetermode.value;
        }

        // Battery info from config (Fuji uses 'd36b' key)
        if (config.d36b?.value) {
          // Battery format: "4,0,0" -> extract first number as percentage
          const batteryParts = config.d36b.value.split(',');
          initialValues.battery = batteryParts[0];
        } else if (config.battery?.value) {
          // Some cameras might use 'battery' key
          const batteryParts = config.battery.value.split(',');
          initialValues.battery = batteryParts[0];
        }

        console.log('Extracted initial values from config:', initialValues);

        const newOptions: typeof cameraSettingOptions = {
          iso: convertedIsoChoices,
          aperture: apertureConfig,
          shutterspeed: config.shutterspeed?.choices || [],
          shutterspeed2: config.shutterspeed2?.choices || [],
          whitebalance: config.whitebalance?.choices || [],
          exposurecompensation: config.exposurecompensation?.choices || [],
          ev: evChoices,
        };
        setCameraSettingOptions(newOptions);
        console.log('Camera setting options:', newOptions);

        // Notify parent component of loaded options with initial values
        // Pass the initial values directly so they can be applied synchronously with the options
        if (onCameraOptionsLoaded) {
          onCameraOptionsLoaded(newOptions, true, initialValues);
        }

        // Mark camera as connected via HTTP API (WebSocket may not be available yet)
        setCameraHttpConnected(true, camera.id);

        // Config returns lensname as an object with label, type, value
        if (config.lensname?.value) {
          const cleaned = cleanLensName(config.lensname.value);
          console.log(`Found lens info: "${config.lensname.value}" -> "${cleaned}"`);
          setLensInfo(cleaned);
        } else {
          console.log('No lensname found in config');
        }
      } else {
        console.error('Config response not OK:', configResponse.status, configResponse.statusText);
      }
    } catch (error) {
      console.error('Error fetching camera info:', error);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnectCamera = () => {
    setSelectedCamera(null);
    setIsConnected(false);
    setCameraStatus(null);
    // Trigger disconnect in context
    disconnect();
    // Mark HTTP camera connection as false
    setCameraHttpConnected(false);
  };

  const getCameraDisplayName = (camera: CameraInfo) => {
    return `${camera.manufacturer} ${camera.model}`.trim();
  };

  // Clean up lens name from format "LX202A,AF 27/1.2 XF      ,88H887AD" to "AF 27/1.2 XF"
  const cleanLensName = (rawLensName: string): string => {
    // Lens name format: CODE,MODEL,SERIAL - extract the middle part
    const parts = rawLensName.split(',');
    if (parts.length >= 2) {
      return parts[1].trim();
    }
    return rawLensName.trim();
  };

  // Get battery icon based on percentage
  const getBatteryIcon = (percentage: string | null): string => {
    if (!percentage) return mdiBatteryAlert;

    const level = parseInt(percentage, 10);
    if (isNaN(level)) return mdiBatteryAlert;

    if (level <= 10) return mdiBattery10;
    if (level <= 20) return mdiBattery20;
    if (level <= 30) return mdiBattery30;
    if (level <= 40) return mdiBattery40;
    if (level <= 50) return mdiBattery50;
    if (level <= 60) return mdiBattery60;
    if (level <= 70) return mdiBattery70;
    if (level <= 80) return mdiBattery80;
    if (level <= 90) return mdiBattery90;
    return mdiBattery;
  };

  // Get choices for a specific setting from config
  const getSettingChoices = (settingName: string): string[] => {
    if (!cameraConfig?.[settingName]?.choices) return [];
    return cameraConfig[settingName].choices;
  };

  // Get current value for a setting
  const getSettingValue = (settingName: string): string => {
    return cameraStatus?.[settingName] || '';
  };

  // Send setting to camera
  const setCameraSetting = async (setting: string, value: string) => {
    console.log('[CameraSection] setCameraSetting:', setting, value, 'selectedCamera:', selectedCamera);
    if (!selectedCamera) {
      console.warn('[CameraSection] No selected camera, skipping setting');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/camera/config?camera=${selectedCamera.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ setting, value }),
      });

      if (!response.ok) {
        console.error(`Failed to set ${setting} to ${value}:`, response.statusText);
        return false;
      }

      console.log(`[CameraSection] Successfully set ${setting} to ${value}`);
      return true;
    } catch (error) {
      console.error(`[CameraSection] Error setting ${setting}:`, error);
      return false;
    }
  };

  // Helper to determine if an EV tick should be short (1/3 or 2/3 increments)
  const isEvShortTick = (evValue: string): boolean => {
    // Short tick at 0.3 and 0.7 values (representing 1/3 and 2/3 EV)
    // Long ticks at whole numbers: 0.0, ±1.0, ±2.0, ±3.0
    return evValue.includes('.3') || evValue.includes('.7');
  };

  const createDialControl = (
    title: string,
    options: string[],
    value: number,
    onChange: (value: number) => void,
    leftHint: string,
    rightHint: string,
    showArrows?: boolean,
    onCommit?: (value: string) => void,
    disabled?: boolean,
    isShortTick?: (optionValue: string) => boolean,
    previewState?: number | null,
    setPreviewState?: (value: number | null) => void
  ) => {
    // Use preview state if provided, otherwise use the value directly
    const displayValue = previewState !== null && previewState !== undefined ? previewState : value;

    const handlePointerDown = (e: React.PointerEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startValue = displayValue;
      const viewportWidth = (e.currentTarget as HTMLElement).offsetWidth;
      const optionsRange = options.length - 1;
      let isDragging = true;
      let currentDragValue = startValue; // Track the current drag value

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (!isDragging) return;
        const deltaX = moveEvent.clientX - startX;
        const indexDelta = (deltaX / viewportWidth) * optionsRange;
        const newValue = Math.max(0, Math.min(optionsRange, startValue - indexDelta));
        currentDragValue = newValue; // Update the tracked value
        if (setPreviewState) {
          setPreviewState(newValue);
        }
      };

      const handlePointerUp = () => {
        isDragging = false;
        const finalValue = Math.round(currentDragValue); // Use the tracked drag value
        if (setPreviewState) {
          setPreviewState(null); // Clear preview state
        }
        onChange(finalValue);
        onCommit?.(options[finalValue]);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    };

    return (
      <div className="setting-control-panel">
        <div className="setting-control-header">
          <span className="setting-control-title">{title}</span>
          <button
            className="setting-control-close"
            onClick={() => onSetActiveSetting(null)}
          >
            <ChevronDown size={14} />
          </button>
        </div>
        <div className="shutter-dial-container">
          <div className="shutter-dial-viewport" onPointerDown={handlePointerDown}>
            {/* Fixed indicator in center */}
            <div className="shutter-indicator-fixed">
              <div className="shutter-indicator-triangle" />
            </div>

            {/* Tick marks overlay - moves with slider */}
            <div
              className="shutter-ticks-container"
              style={{
                transform: `translateX(${50 - (displayValue / (options.length - 1)) * 100}%)`
              }}
            >
              {options.map((option, index) => {
                const position = (index / (options.length - 1)) * 100;
                const isActive = Math.abs(index - displayValue) < 0.5;
                const isShort = isShortTick?.(option);

                return (
                  <div
                    key={index}
                    className={`shutter-tick ${isActive ? 'shutter-tick-active' : ''} ${isShort ? 'shutter-tick-short' : ''}`}
                    style={{ left: `${position}%` }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      {showArrows !== false && (
        <>
          <div className="shutter-dial-controls">
            <button
              className="shutter-dial-arrow"
              onClick={() => {
                const newValue = Math.max(0, value - 1);
                onChange(newValue);
                onCommit?.(options[newValue]);
              }}
              disabled={value === 0 || disabled}
            >
              <ChevronDown size={16} style={{ transform: 'rotate(90deg)' }} />
            </button>
            <div className="shutter-dial-label">{options[Math.round(displayValue)]}</div>
            <button
              className="shutter-dial-arrow"
              onClick={() => {
                const newValue = Math.min(options.length - 1, value + 1);
                onChange(newValue);
                onCommit?.(options[newValue]);
              }}
              disabled={value === options.length - 1 || disabled}
            >
              <ChevronDown size={16} style={{ transform: 'rotate(-90deg)' }} />
            </button>
          </div>
          <div className="shutter-dial-hints">
            <span className="shutter-hint-slow">{leftHint}</span>
            <span className="shutter-hint-fast">{rightHint}</span>
          </div>
        </>
      )}
    </div>
    );
  };

  return (
    <div className="collapsible-section">
      <button
        className="collapsible-header"
        onClick={() => toggleSection('camera')}
      >
        <div className="collapsible-header-left">
          {expandedSections.camera ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="collapsible-title">Camera</span>
        </div>
      </button>
      {expandedSections.camera && (
        <div className="collapsible-content">
          {/* Camera Selection / Info Row */}
          {!isConnected ? (
            <div className="camera-selection-row">
              <div className="camera-selection-container">
                <button
                  className="connect-camera-btn"
                  onClick={() => setShowCameraDropdown(!showCameraDropdown)}
                  disabled={isLoadingCameras || availableCameras.length === 0}
                >
                  <Camera size={16} />
                  <span className="connect-camera-text">
                    {isLoadingCameras
                      ? 'Detecting cameras...'
                      : availableCameras.length === 0
                      ? 'No cameras found'
                      : 'Select Camera'}
                  </span>
                  <ChevronDown size={14} className={showCameraDropdown ? 'rotate-180' : ''} />
                </button>
                <button
                  className="refresh-cameras-btn"
                  onClick={fetchCameras}
                  disabled={isLoadingCameras}
                  title="Refresh camera list"
                >
                  <RefreshCw size={14} className={isLoadingCameras ? 'spinning' : ''} />
                </button>
              </div>
              {showCameraDropdown && availableCameras.length > 0 && (
                <div className="camera-dropdown-menu">
                  {availableCameras.map((camera) => (
                    <button
                      key={camera.id}
                      className="camera-dropdown-item"
                      onClick={() => handleConnectCamera(camera)}
                    >
                      <div className="camera-dropdown-info">
                        <div className="camera-dropdown-model">{getCameraDisplayName(camera)}</div>
                        {camera.usb_version ? (
                          <div className="camera-dropdown-usb">{camera.usb_version}</div>
                        ) : (
                          <div className="camera-dropdown-port">{camera.port}</div>
                        )}
                      </div>
                      <Icon path={mdiUsb } size={0.8} className="connection-icon" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="camera-info-row">
              <div className="camera-info-left">
                <div className="camera-name">
                  <Camera size={14} />
                  <span>{selectedCamera ? getCameraDisplayName(selectedCamera) : 'Unknown Camera'}</span>
                </div>
                {lensInfo ? (
                  <div className="lens-info">{lensInfo}</div>
                ) : (
                  <div className="lens-info">---</div>
                )}
              </div>
              <button className="disconnect-btn" onClick={handleDisconnectCamera}>
                <Plug size={14} />
                <span>Disconnect</span>
              </button>
            </div>
          )}

          {/* Camera Control Panel - Only show when connected */}
          {isConnected && (
            <div className="camera-control-panel">
              <div className="top-row">
                <span
                  className={`mode-indicator ${activeSetting === 'mode' ? 'active' : ''}`}
                  onClick={() => onSetActiveSetting(activeSetting === 'mode' ? null : 'mode')}
                >
                  {normalizedMode}
                  {activeSetting === 'mode' && <ChevronUp size={10} className="mode-chevron" />}
                </span>
                <div className="right-group">
                  <Icon path={getBatteryIcon(batteryLevel)} size={0.9} className="battery-icon" />
                  {batteryLevel && (
                    <span className="battery-level">
                      {batteryLevel}%
                    </span>
                  )}
                </div>
              </div>
            <div className="settings-grid">
              <div
                className={`setting-cell ${activeSetting === 'shutter' ? 'active' : ''} ${!isSettingAdjustable(shootingMode, 'shutter', cameraBrand) ? 'disabled' : ''}`}
                onClick={() => isSettingAdjustable(shootingMode, 'shutter', cameraBrand) && onToggleSetting('shutter')}
              >
                <span className="setting-label">SHUTTER</span>
                <span className="setting-value">
                  {displayShutter === -1 ? '---' : shutterSpeeds[displayShutter]} {activeSetting === 'shutter' && isSettingAdjustable(shootingMode, 'shutter', cameraBrand) && <ChevronUp size={12} className="setting-chevron" />}
                </span>
                {pendingSettings?.['shutter'] && <span className="pending-indicator" />}
              </div>
              <div
                className={`setting-cell ${activeSetting === 'aperture' ? 'active' : ''} ${!isSettingAdjustable(shootingMode, 'aperture', cameraBrand) ? 'disabled' : ''}`}
                onClick={() => isSettingAdjustable(shootingMode, 'aperture', cameraBrand) && onToggleSetting('aperture')}
              >
                <span className="setting-label">APERTURE</span>
                <span className="setting-value">
                  {apertureIndex === -1 ? '---' : apertureOptions[apertureIndex]} {activeSetting === 'aperture' && isSettingAdjustable(shootingMode, 'aperture', cameraBrand) && <ChevronUp size={12} className="setting-chevron" />}
                </span>
                {pendingSettings?.['aperture'] && <span className="pending-indicator" />}
              </div>
              <div
                className={`setting-cell ${activeSetting === 'iso' ? 'active' : ''}`}
                onClick={() => onToggleSetting('iso')}
              >
                <span className="setting-label">ISO</span>
                <span className="setting-value">
                  {isoIndex === -1 ? '---' : isoOptions[isoIndex]} {activeSetting === 'iso' && <ChevronUp size={12} className="setting-chevron" />}
                </span>
                {pendingSettings?.['iso'] && <span className="pending-indicator" />}
              </div>
              <div
                className={`setting-cell ${activeSetting === 'ev' ? 'active' : ''} ${!isSettingAdjustable(shootingMode, 'ev', cameraBrand) ? 'disabled' : ''}`}
                onClick={() => isSettingAdjustable(shootingMode, 'ev', cameraBrand) && onToggleSetting('ev')}
              >
                <span className="setting-label">EV</span>
                <span className="setting-value">
                  {evIndex === -1 ? '---' : evOptions[evIndex]} {activeSetting === 'ev' && isSettingAdjustable(shootingMode, 'ev', cameraBrand) && <ChevronUp size={12} className="setting-chevron" />}
                </span>
                {pendingSettings?.['ev'] && <span className="pending-indicator" />}
              </div>
              <div
                className={`setting-cell ${activeSetting === 'wb' ? 'active' : ''}`}
                onClick={() => onToggleSetting('wb')}
              >
                <span className="setting-label">WB</span>
                <span className="setting-value">
                  {!wbValue ? '---' : wbValue} {activeSetting === 'wb' && <ChevronUp size={12} className="setting-chevron" />}
                </span>
                {pendingSettings?.['wb'] && <span className="pending-indicator" />}
              </div>
              <div
                className={`setting-cell ${activeSetting === 'metering' ? 'active' : ''}`}
                onClick={() => onToggleSetting('metering')}
              >
                <span className="setting-label">METERING</span>
                <span className="setting-value">{meteringValue} {activeSetting === 'metering' && <ChevronUp size={12} className="setting-chevron" />}</span>
              </div>
            </div>
          </div>
          )}

          {/* Setting Control Panel */}
          {activeSetting === 'shutter' && (
            <div className="setting-control-panel">
              <div className="setting-control-header">
                <span className="setting-control-title">SHUTTER SPEED</span>
                <button
                  className="setting-control-close"
                  onClick={() => onSetActiveSetting(null)}
                >
                  <ChevronDown size={14} />
                </button>
              </div>
              <div className="shutter-dial-container">
                <div className="shutter-dial-viewport">
                  {/* Fixed indicator in center */}
                  <div className="shutter-indicator-fixed">
                    <div className="shutter-indicator-triangle" />
                  </div>

                  {/* Tick marks overlay - moves with slider */}
                  <div
                    className="shutter-ticks-container"
                    style={{
                      transform: `translateX(${50 - (displayShutter / (shutterSpeeds.length - 1)) * 100}%)`
                    }}
                  >
                    {shutterSpeeds.map((_, index) => {
                      const position = (index / (shutterSpeeds.length - 1)) * 100;
                      const isActive = Math.abs(index - displayShutter) < 0.5;

                      return (
                        <div
                          key={index}
                          className={`shutter-tick ${isActive ? 'shutter-tick-active' : ''}`}
                          style={{ left: `${position}%` }}
                        />
                      );
                    })}
                  </div>

                  {/* Radix Slider (invisible interaction layer) */}
                  <Slider.Root
                    className="shutter-slider-root"
                    value={[displayShutter === -1 ? 0 : displayShutter]}
                    onValueChange={(value) => {
                      if (shutterValue !== -1 && isSettingAdjustable(shootingMode, 'shutter', cameraBrand)) {
                        setShutterPreview(value[0]); // Only update preview, no API call
                      }
                    }}
                    onValueCommit={(value) => {
                      if (shutterValue !== -1 && isSettingAdjustable(shootingMode, 'shutter', cameraBrand)) {
                        setShutterPreview(null); // Clear preview
                        onSetShutterValue(value[0]); // Send API and set pending
                      }
                    }}
                    min={0}
                    max={shutterSpeeds.length - 1}
                    step={1}
                    inverted={true}
                    disabled={shutterValue === -1 || !isSettingAdjustable(shootingMode, 'shutter', cameraBrand)}
                  >
                    <Slider.Track className="shutter-slider-track">
                      <Slider.Range className="shutter-slider-range" />
                    </Slider.Track>
                    <Slider.Thumb className="shutter-slider-thumb" />
                  </Slider.Root>
                </div>
              </div>
              <div className="shutter-dial-controls">
                <button
                  className="shutter-dial-arrow"
                  onClick={() => {
                    const newValue = Math.max(0, shutterValue - 1);
                    setShutterPreview(null);
                    onSetShutterValue(newValue);
                  }}
                  disabled={shutterValue <= 0 || !isSettingAdjustable(shootingMode, 'shutter', cameraBrand)}
                >
                  <ChevronDown size={16} style={{ transform: 'rotate(90deg)' }} />
                </button>
                <div className="shutter-dial-label">{displayShutter === -1 ? '---' : shutterSpeeds[displayShutter]}</div>
                <button
                  className="shutter-dial-arrow"
                  onClick={() => {
                    const newValue = Math.min(shutterSpeeds.length - 1, shutterValue + 1);
                    setShutterPreview(null);
                    onSetShutterValue(newValue);
                  }}
                  disabled={shutterValue === shutterSpeeds.length - 1 || !isSettingAdjustable(shootingMode, 'shutter', cameraBrand)}
                >
                  <ChevronDown size={16} style={{ transform: 'rotate(-90deg)' }} />
                </button>
              </div>
              <div className="shutter-dial-hints">
                <span className="shutter-hint-slow">Slow</span>
                <span className="shutter-hint-fast">Fast</span>
              </div>
            </div>
          )}

          {activeSetting === 'aperture' && createDialControl(
            'APERTURE',
            apertureOptions,
            apertureIndex,
            onSetApertureIndex,
            'Open',
            'Closed',
            true,
            (value) => setCameraSetting('f-number', value),
            !isSettingAdjustable(shootingMode, 'aperture', cameraBrand),
            undefined,
            aperturePreview,
            setAperturePreview
          )}

          {activeSetting === 'iso' && createDialControl(
            'ISO',
            isoOptions,
            isoIndex,
            onSetIsoIndex,
            'Low',
            'High',
            true,
            (value) => setCameraSetting('iso', value),
            !isSettingAdjustable(shootingMode, 'iso', cameraBrand),
            undefined,
            isoPreview,
            setIsoPreview
          )}

          {activeSetting === 'ev' && createDialControl(
            'EXPOSURE COMPENSATION',
            evOptions,
            evIndex,
            onSetEvIndex,
            'Dark',
            'Bright',
            true,
            (value) => cameraSettingsService.setEvFromDisplay(value),
            !isSettingAdjustable(shootingMode, 'ev', cameraBrand),
            isEvShortTick,
            evPreview,
            setEvPreview
          )}

          {activeSetting === 'wb' && (
            <div className="setting-control-panel">
              <div className="setting-control-header">
                <span className="setting-control-title">WHITE BALANCE</span>
                <button
                  className="setting-control-close"
                  onClick={() => onSetActiveSetting(null)}
                >
                  <ChevronDown size={14} />
                </button>
              </div>
              <div className="wb-options-vertical">
                {(() => {
                  const wbLabels = cameraBrand.quirks.whiteBalanceLabels || {};
                  const cameraChoices = cameraSettingOptions.whitebalance;

                  // Icons for white balance options
                  const wbIcons: Record<string, string> = {
                    'Auto': mdiWhiteBalanceAuto,
                    'Daylight': mdiWhiteBalanceSunny,
                    'Shade': mdiCloud,
                    'K': mdiThermometer,
                    'Incandescent': mdiLightbulb,
                    'Tungsten': mdiLightbulb,
                    'Fluorescent 1': mdiLightbulb,
                    'Fluorescent 2': mdiLightbulb,
                    'Fluorescent 3': mdiLightbulb,
                    'Underwater': mdiWater,
                    'C1': mdiNumeric1,
                    'C2': mdiNumeric2,
                    'C3': mdiNumeric3,
                    'White Priority': mdiWhiteBalanceAuto,
                    'Ambient Priority': mdiWhiteBalanceAuto,
                  };

                  // Build the list of WB options to display
                  let wbOptions: [string, string][]; // [cameraValue, displayLabel]

                  if (cameraChoices.length > 0) {
                    // Use camera-reported choices, map to display labels
                    wbOptions = cameraChoices.map((cameraValue) => {
                      const mapped = wbLabels[cameraValue];
                      return [cameraValue, mapped || cameraValue];
                    });
                  } else if (Object.keys(wbLabels).length > 0) {
                    // Fallback: use the label mapping
                    wbOptions = Object.entries(wbLabels).map(([cameraValue, displayLabel]) => [
                      cameraValue,
                      displayLabel
                    ]);
                  } else {
                    // Final fallback: generic options
                    wbOptions = [
                      ['Auto', 'Auto'],
                      ['Daylight', 'Daylight'],
                      ['Cloudy', 'Cloudy'],
                      ['Tungsten', 'Tungsten'],
                      ['Fluorescent', 'Fluorescent'],
                      ['Flash', 'Flash'],
                      ['Custom', 'Custom'],
                    ];
                  }

                  return wbOptions.map(([cameraValue, displayLabel]) => {
                    const isSelected = wbValue === displayLabel;
                    const iconPath = wbIcons[displayLabel];

                    return (
                      <button
                        key={cameraValue}
                        className={`wb-option-vertical-btn ${isSelected ? 'wb-selected' : ''}`}
                        data-wb={displayLabel}
                        onClick={() => {
                          cameraSettingsService.setWhiteBalance(displayLabel);
                          onSetWbValue(displayLabel);
                        }}
                      >
                        <div className="wb-option-icon-wrapper">
                          {iconPath && <Icon path={iconPath} size={1.1} className="wb-option-icon" />}
                        </div>
                        <span className="wb-option-label">{displayLabel}</span>
                      </button>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {activeSetting === 'metering' && (
            <div className="setting-control-panel">
              <div className="setting-control-header">
                <span className="setting-control-title">METERING MODE</span>
                <button
                  className="setting-control-close"
                  onClick={() => onSetActiveSetting(null)}
                >
                  <ChevronDown size={14} />
                </button>
              </div>
              <div className="setting-options-grid">
                {[
                  { label: 'Evaluative', icon: <Icon path={mdiCameraMeteringMatrix} size={1} /> },
                  { label: 'Partial', icon: <Icon path={mdiCameraMeteringPartial} size={1} /> },
                  { label: 'Spot', icon: <Icon path={mdiCameraMeteringSpot} size={1} /> },
                  { label: 'Center-Weighted', icon: <Icon path={mdiCameraMeteringCenter} size={1} /> },
                ].map((option) => (
                  <button
                    key={option.label}
                    className={`setting-option-btn ${meteringValue === option.label ? 'setting-option-selected' : ''}`}
                    onClick={() => onSetMeteringValue(option.label)}
                  >
                    {option.icon}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeSetting === 'mode' && (
            <div className="setting-control-panel">
              <div className="setting-control-header">
                <span className="setting-control-title">SHOOTING MODE</span>
                <button
                  className="setting-control-close"
                  onClick={() => onSetActiveSetting(null)}
                >
                  <ChevronDown size={14} />
                </button>
              </div>
              <div className="setting-options-grid">
                {[
                  { label: 'P', description: 'Program' },
                  { label: 'A', description: 'Aperture Priority' },
                  { label: 'S', description: 'Shutter Priority' },
                  { label: 'M', description: 'Manual' },
                ].map((option) => (
                  <button
                    key={option.label}
                    className={`setting-option-btn ${normalizedMode === option.label ? 'setting-option-selected' : ''}`}
                    onClick={() => cameraSettingsService.setMode(option.label as any)}
                  >
                    <span className="mode-option-label">{option.label}</span>
                    <span className="mode-option-description">{option.description}</span>
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

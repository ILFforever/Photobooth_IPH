import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import * as Slider from "@radix-ui/react-slider";
import { open } from '@tauri-apps/plugin-dialog';
import { CameraSection } from "./CameraSection";
import { LiveViewSection } from "./LiveViewSection";
import { ImageQuality } from "./ImageQuality";
import { FocusSettings } from "./FocusSettings";
import { useCamera } from "../../../contexts/CameraContext";
import type { CameraStatus } from "../../../services/cameraWebSocket";
import "./PhotoboothSidebar.css";

const API_BASE = 'http://localhost:58321';

interface PhotoboothSidebarProps {
  // Camera-provided shutter speeds (ordered from fast to slow)
  shutterSpeeds?: string[];
  apertureValues?: string[];
  isoValues?: string[];
}

type PhotoboothTab = 'camera' | 'settings';

type CollapsibleSection = 'camera' | 'liveview' | 'folder' | 'photobooth';
type SettingType = 'shutter' | 'aperture' | 'iso' | 'ev' | 'wb' | 'metering' | 'folder' | 'mode' | null;

export default function PhotoboothSidebar(props: PhotoboothSidebarProps) {
  const { addStatusListener, removeStatusListener } = useCamera();

  const [activeTab, setActiveTab] = useState<PhotoboothTab>('camera');
  const [expandedSections, setExpandedSections] = useState<Record<CollapsibleSection, boolean>>({
    camera: true,
    liveview: false,
    folder: false,
    photobooth: true,
  });
  const [activeSetting, setActiveSetting] = useState<SettingType>(null);

  // Default shutter speeds (fast to slow) - will be reversed for the dial
  const defaultShutterSpeeds = [
    '1/8000', '1/6400', '1/5000', '1/4000', '1/3200', '1/2500', '1/2000',
    '1/1600', '1/1250', '1/1000', '1/800', '1/640', '1/500', '1/400', '1/320',
    '1/250', '1/200', '1/160', '1/125', '1/100', '1/80', '1/60', '1/50',
    '1/40', '1/30', '1/25', '1/20', '1/15', '1/13', '1/10', '1/8', '1/6',
    '1/5', '1/4', '0.3s', '0.5s', '0.8s', '1s', '1.5s', '2s', '3s', '4s',
    '6s', '8s', '10s', '15s', '20s', '30s'
  ];

  // Setting options - can be updated from camera
  const [cameraApertureOptions, setCameraApertureOptions] = useState<string[]>([]);
  const [cameraIsoOptions, setCameraIsoOptions] = useState<string[]>([]);
  const [cameraShutterOptions, setCameraShutterOptions] = useState<string[]>([]);
  const [cameraWbOptions, setCameraWbOptions] = useState<string[]>([]);
  const [cameraEvOptions, setCameraEvOptions] = useState<string[]>([]);

  // Use camera-provided values or defaults - memoized to prevent WebSocket reconnection
  const shutterSpeeds = useMemo(() =>
    cameraShutterOptions.length > 0 ? cameraShutterOptions : (props.shutterSpeeds || defaultShutterSpeeds),
    [cameraShutterOptions, props.shutterSpeeds]
  );
  const apertureOptions = useMemo(() =>
    cameraApertureOptions.length > 0 ? cameraApertureOptions : ['f/1.4', 'f/1.8', 'f/2.0', 'f/2.8', 'f/4.0', 'f/5.6', 'f/8.0', 'f/11', 'f/16', 'f/22'],
    [cameraApertureOptions]
  );
  const isoOptions = useMemo(() =>
    cameraIsoOptions.length > 0 ? cameraIsoOptions : ['100', '200', '400', '800', '1600', '3200', '6400', '12800', '25600', '51200'],
    [cameraIsoOptions]
  );
  const evOptions = useMemo(() =>
    cameraEvOptions.length > 0 ? cameraEvOptions : [
      '-3.0', '-2.7', '-2.3', '-2.0', '-1.7', '-1.3', '-1.0', '-0.7', '-0.3', '0.0',
      '+0.3', '+0.7', '+1.0', '+1.3', '+1.7', '+2.0', '+2.3', '+2.7', '+3.0'
    ],
    [cameraEvOptions]
  );
  const wbOptions = useMemo(() =>
    cameraWbOptions.length > 0 ? cameraWbOptions : ['Auto', 'Daylight', 'Cloudy', 'Tungsten', 'Fluorescent', 'Flash', 'Custom'],
    [cameraWbOptions]
  );

  // Setting values - store as indexes for dial controls
  // Start with -1 to indicate "fetching" state, will show "---" until camera data loads
  const [shutterValue, setShutterValue] = useState(-1);
  const [apertureIndex, setApertureIndex] = useState(-1);
  const [isoIndex, setIsoIndex] = useState(-1);
  const [evIndex, setEvIndex] = useState(-1);
  const [wbValue, setWbValue] = useState(''); // Empty string indicates fetching
  const [meteringValue, setMeteringValue] = useState('Evaluative');

  // Pending settings state - tracks which settings are awaiting confirmation from camera
  // Format: { settingName: expectedValue }
  const [pendingSettings, setPendingSettings] = useState<Record<string, string>>({});
  const pendingTimeoutsRef = useRef<Record<string, number>>({});
  // Debounce timeouts for API calls - waits for user to stop changing before sending
  const debounceTimeoutsRef = useRef<Record<string, number>>({});
  const DEBOUNCE_MS = 500;

  // Photobooth settings
  const [autoCount, setAutoCount] = useState(3); // Number of photos to take
  const [timerDelay, setTimerDelay] = useState(5); // Delay in seconds
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null); // Selected folder path
  const [imageQualityExpanded, setImageQualityExpanded] = useState(false);
  const [focusSettingsExpanded, setFocusSettingsExpanded] = useState(false);

  const toggleSection = (section: CollapsibleSection) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleBrowseFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Working Folder'
      });
      if (selected && typeof selected === 'string') {
        setSelectedFolder(selected);
      }
    } catch (error) {
      console.error('Failed to open folder dialog:', error);
    }
  };

  const toggleSetting = (setting: SettingType) => {
    setActiveSetting(prev => prev === setting ? null : setting);
  };

  // Send camera setting to API and mark as pending confirmation
  const sendCameraSetting = async (setting: string, value: string) => {
    try {
      console.log(`[API] Setting ${setting} to ${value}`);
      const response = await fetch(`${API_BASE}/api/camera/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setting, value })
      });
      if (!response.ok) {
        console.error(`[API] Failed to set ${setting}:`, response.statusText);
      }
    } catch (error) {
      console.error(`[API] Error setting ${setting}:`, error);
    }
  };

  // Helper: update UI immediately, debounce the API call, and track pending state
  const debouncedSetSetting = (
    pendingKey: string,
    apiSetting: string,
    settingValue: string
  ) => {
    // Mark as pending immediately
    setPendingSettings(prev => ({ ...prev, [pendingKey]: settingValue }));

    // Debounce the API call — only sends once user stops changing
    if (debounceTimeoutsRef.current[pendingKey]) {
      clearTimeout(debounceTimeoutsRef.current[pendingKey]);
    }
    debounceTimeoutsRef.current[pendingKey] = window.setTimeout(() => {
      sendCameraSetting(apiSetting, settingValue);
    }, DEBOUNCE_MS);

    // Reset the pending-expiry timeout (clears red dot if WS never confirms)
    if (pendingTimeoutsRef.current[pendingKey]) {
      clearTimeout(pendingTimeoutsRef.current[pendingKey]);
    }
    pendingTimeoutsRef.current[pendingKey] = window.setTimeout(() => {
      setPendingSettings(prev => {
        const { [pendingKey]: _, ...rest } = prev;
        return rest;
      });
    }, 3000 + DEBOUNCE_MS);
  };

  // Wrapper setters — UI updates are instant, API calls are debounced
  const handleSetShutterValue = (value: number) => {
    setShutterValue(value);
    debouncedSetSetting('shutter', 'shutterspeed', shutterSpeeds[value]);
  };

  const handleSetApertureIndex = (value: number) => {
    setApertureIndex(value);
    debouncedSetSetting('aperture', 'f-number', apertureOptions[value]);
  };

  const handleSetIsoIndex = (value: number) => {
    setIsoIndex(value);
    debouncedSetSetting('iso', 'iso', isoOptions[value]);
  };

  const handleSetEvIndex = (value: number) => {
    setEvIndex(value);
    debouncedSetSetting('ev', 'exposurecompensation', evOptions[value]);
  };

  const handleSetWbValue = (value: string) => {
    setWbValue(value);
    debouncedSetSetting('wb', 'whitebalance', value);
  };

  // Confirm a setting value received from WebSocket - clears red dot if matches
  // Memoized with useCallback to prevent WebSocket reconnection loops
  const confirmSettingValue = useCallback((setting: string, actualValue: string) => {
    setPendingSettings(prev => {
      if (prev[setting] === actualValue) {
        // Clear the timeout
        if (pendingTimeoutsRef.current[setting]) {
          clearTimeout(pendingTimeoutsRef.current[setting]);
          delete pendingTimeoutsRef.current[setting];
        }
        // Remove from pending state
        const { [setting]: removed, ...rest } = prev;
        return rest;
      }
      return prev;
    });
  }, []);

  // Subscribe to WebSocket status updates via CameraContext
  // Uses refs for options so the callback doesn't need to change when options change
  const optionsRef = useRef({ shutterSpeeds, apertureOptions, isoOptions, evOptions });
  useEffect(() => {
    optionsRef.current = { shutterSpeeds, apertureOptions, isoOptions, evOptions };
  }, [shutterSpeeds, apertureOptions, isoOptions, evOptions]);

  const handleWsStatus = useCallback((data: CameraStatus) => {
    const opts = optionsRef.current;

    if (data.iso && opts.isoOptions.length > 0) {
      const idx = opts.isoOptions.findIndex(opt => opt === data.iso);
      if (idx !== -1) {
        confirmSettingValue('iso', data.iso!);
        setIsoIndex(idx);
      }
    }
    if (data.aperture && opts.apertureOptions.length > 0) {
      const idx = opts.apertureOptions.findIndex(opt => opt === data.aperture);
      if (idx !== -1) {
        confirmSettingValue('aperture', data.aperture!);
        setApertureIndex(idx);
      }
    }
    if (data.shutter && opts.shutterSpeeds.length > 0) {
      const idx = opts.shutterSpeeds.findIndex(opt => opt === data.shutter);
      if (idx !== -1) {
        confirmSettingValue('shutter', data.shutter!);
        setShutterValue(idx);
      }
    }
    if (data.ev && opts.evOptions.length > 0) {
      const idx = opts.evOptions.findIndex(opt => opt === data.ev);
      if (idx !== -1) {
        confirmSettingValue('ev', data.ev!);
        setEvIndex(idx);
      }
    }
    if (data.wb) {
      confirmSettingValue('wb', data.wb);
      setWbValue(data.wb);
    }
  }, [confirmSettingValue]);

  useEffect(() => {
    addStatusListener(handleWsStatus);
    return () => removeStatusListener(handleWsStatus);
  }, [handleWsStatus, addStatusListener, removeStatusListener]);

  // Handle camera options loaded from camera config
  // Memoized with useCallback to prevent WebSocket reconnection loops
  const handleCameraOptionsLoaded = useCallback((options: { iso: string[]; aperture: string[]; shutterspeed: string[]; whitebalance: string[]; '5010'?: string[] }) => {
    console.log('Camera options loaded:', options);
    setCameraApertureOptions(options.aperture);
    setCameraIsoOptions(options.iso);
    setCameraShutterOptions(options.shutterspeed);
    setCameraWbOptions(options.whitebalance);
    // Use '5010' EV choices for Fuji cameras (already converted to standard format)
    if (options['5010'] && options['5010'].length > 0) {
      setCameraEvOptions(options['5010']);
    }

    // Reset indexes to safe defaults when options change
    setApertureIndex(0);
    setIsoIndex(2);
    if (options.shutterspeed.length > 0) {
      setShutterValue(Math.floor(options.shutterspeed.length / 2));
    }
  }, []);

  return (
    <div className="photobooth-sidebar">
      <div className="sidebar">
        <h2 className="sidebar-title">Photobooth</h2>

        <div className="sidebar-divider" />

        <div className="photobooth-sidebar-content">
          <div className="photobooth-tab-selector">
            <button
              className={`photobooth-tab ${activeTab === 'camera' ? 'active' : ''}`}
              onClick={() => setActiveTab('camera')}
            >
              Camera
            </button>
            <button
              className={`photobooth-tab ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              Settings
            </button>
          </div>

          <div className="photobooth-tab-content">
            {activeTab === 'camera' ? (
              <div className="tab-panel">
                {/* Camera Info Section */}
                <CameraSection
                  expandedSections={expandedSections}
                  toggleSection={toggleSection}
                  shutterSpeeds={shutterSpeeds}
                  apertureOptions={apertureOptions}
                  isoOptions={isoOptions}
                  evOptions={evOptions}
                  shutterValue={shutterValue}
                  apertureIndex={apertureIndex}
                  isoIndex={isoIndex}
                  evIndex={evIndex}
                  wbValue={wbValue}
                  meteringValue={meteringValue}
                  activeSetting={activeSetting}
                  onToggleSetting={toggleSetting}
                  onSetShutterValue={handleSetShutterValue}
                  onSetApertureIndex={handleSetApertureIndex}
                  onSetIsoIndex={handleSetIsoIndex}
                  onSetEvIndex={handleSetEvIndex}
                  onSetWbValue={handleSetWbValue}
                  onSetMeteringValue={setMeteringValue}
                  onSetActiveSetting={setActiveSetting}
                  onCameraOptionsLoaded={handleCameraOptionsLoaded}
                  pendingSettings={pendingSettings}
                />

                {/* Live View Section */}
                <LiveViewSection
                  expandedSections={expandedSections}
                  toggleSection={toggleSection}
                />

                {/* Image Quality Section */}
                <ImageQuality
                  isExpanded={imageQualityExpanded}
                  onToggle={() => setImageQualityExpanded(!imageQualityExpanded)}
                />

                {/* Focus Settings Section */}
                <FocusSettings
                  isExpanded={focusSettingsExpanded}
                  onToggle={() => setFocusSettingsExpanded(!focusSettingsExpanded)}
                />
              </div>
            ) : (
              <div className="tab-panel">
                {/* Working Folder Section */}
                <div className="collapsible-section">
                  <button
                    className="collapsible-header"
                    onClick={() => toggleSection('folder' as CollapsibleSection)}
                  >
                    <div className="collapsible-header-left">
                      {expandedSections.folder ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span className="collapsible-title">Working Folder</span>
                    </div>
                  </button>
                  {expandedSections.folder && (
                    <div className="collapsible-content">
                      <div className="setting-cell setting-cell-static">
                        <span className="setting-label">LOCATION</span>
                        <span className="setting-value">
                          {selectedFolder || 'No folder selected'}
                        </span>
                      </div>
                      <button className="folder-browse-btn" onClick={handleBrowseFolder}>
                        Browse...
                      </button>
                    </div>
                  )}
                </div>

                {/* Photobooth Settings Section */}
                <div className="collapsible-section">
                  <button
                    className="collapsible-header"
                    onClick={() => toggleSection('photobooth')}
                  >
                    <div className="collapsible-header-left">
                      {expandedSections.photobooth ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span className="collapsible-title">Photobooth Settings</span>
                    </div>
                  </button>
                  {expandedSections.photobooth && (
                    <div className="collapsible-content">
                      {/* Photo Count Slider */}
                      <div className="slider-setting">
                        <div className="slider-header">
                          <span className="slider-label">Photo Count</span>
                          <span className="slider-value">{autoCount}</span>
                        </div>
                        <div className="slider-wrapper">
                          <div className="slider-track-container">
                            <div className="slider-numbers-container">
                              <div
                                className="slider-active-indicator"
                                style={{
                                  left: `${((autoCount - 1) / 9) * 100}%`,
                                  width: '30px',
                                  transform: 'translateX(-50%)'
                                }}
                              />
                              {Array.from({ length: 10 }, (_, i) => i + 1).map((num) => (
                                <span
                                  key={num}
                                  className={`slider-number-marker ${num === autoCount ? 'active' : ''}`}
                                  style={{
                                    left: `${((num - 1) / 9) * 100}%`
                                  }}
                                >
                                  {num}
                                </span>
                              ))}
                            </div>
                          </div>
                          <Slider.Root
                            className="photobooth-slider"
                            value={[autoCount]}
                            onValueChange={(value) => setAutoCount(value[0])}
                            min={1}
                            max={10}
                            step={1}
                          >
                            <Slider.Thumb className="photobooth-slider-thumb" />
                          </Slider.Root>
                        </div>
                      </div>

                      {/* Timer Delay Slider */}
                      <div className="slider-setting">
                        <div className="slider-header">
                          <span className="slider-label">Timer Delay</span>
                          <span className="slider-value">{timerDelay}s</span>
                        </div>
                        <div className="slider-wrapper">
                          <div className="slider-track-container">
                            <div className="slider-numbers-container">
                              <div
                                className="slider-active-indicator"
                                style={{
                                  left: `${((timerDelay - 1) / 14) * 100}%`,
                                  width: '20px',
                                  transform: 'translateX(-50%)'
                                }}
                              />
                              {Array.from({ length: 15 }, (_, i) => i + 1).map((num) => (
                                <span
                                  key={num}
                                  className={`slider-number-marker ${num === timerDelay ? 'active' : ''}`}
                                  style={{
                                    left: `${((num - 1) / 14) * 100}%`
                                  }}
                                >
                                  {num}
                                </span>
                              ))}
                            </div>
                          </div>
                          <Slider.Root
                            className="photobooth-slider"
                            value={[timerDelay]}
                            onValueChange={(value) => setTimerDelay(value[0])}
                            min={1}
                            max={15}
                            step={1}
                          >
                            <Slider.Thumb className="photobooth-slider-thumb" />
                          </Slider.Root>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

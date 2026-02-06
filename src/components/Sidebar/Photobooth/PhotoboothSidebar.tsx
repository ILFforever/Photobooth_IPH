import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { ChevronDown, ChevronRight, Check, Layers, FolderOpen, Plus, Calendar, Image as ImageIcon } from "lucide-react";
import * as Slider from "@radix-ui/react-slider";
import { open } from '@tauri-apps/plugin-dialog';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { CameraSection } from "./CameraSection";
import { LiveViewSection } from "./LiveViewSection";
import { ImageQuality } from "./ImageQuality";
import { FocusSettings } from "./FocusSettings";
import { useCamera } from "../../../contexts/CameraContext";
import { usePhotoboothSettings, type PhotoboothSessionInfo } from "../../../contexts/PhotoboothSettingsContext";
import type { CameraStatus } from "../../../services/cameraWebSocket";
import { getCameraSettingsService } from "../../../services/cameraSettingsService";
import type { CustomSet, CustomSetPreview } from "../../../types/customSet";

// Get a singleton instance for EV mapping
const cameraSettingsService = getCameraSettingsService();
import "./PhotoboothSidebar.css";

const API_BASE = 'http://localhost:58321';

interface PhotoboothSidebarProps {
  // Camera-provided shutter speeds (ordered from fast to slow)
  shutterSpeeds?: string[];
  apertureValues?: string[];
  isoValues?: string[];
}

type PhotoboothTab = 'camera' | 'settings';

type CollapsibleSection = 'camera' | 'liveview' | 'folder' | 'photobooth' | 'frame' | 'session';
type SettingType = 'shutter' | 'aperture' | 'iso' | 'ev' | 'wb' | 'metering' | 'folder' | 'mode' | null;

export default function PhotoboothSidebar(props: PhotoboothSidebarProps) {
  const { addStatusListener, removeStatusListener, isCameraConnected } = useCamera();

  const [activeTab, setActiveTab] = useState<PhotoboothTab>('camera');
  const [expandedSections, setExpandedSections] = useState<Record<CollapsibleSection, boolean>>({
    camera: false,
    liveview: false,
    folder: false,
    photobooth: false,
    frame: false,
    session: false,
  });
  const [activeSetting, setActiveSetting] = useState<SettingType>(null);

  // Track whether user has selected a camera in CameraSection
  const [hasSelectedCamera, setHasSelectedCamera] = useState(false);

  // Handle connection change callback from CameraSection
  const handleConnectionChange = useCallback((isConnected: boolean, hasSelected: boolean) => {
    console.log('[PhotoboothSidebar] Connection change:', isConnected, hasSelected);
    setHasSelectedCamera(hasSelected);
  }, []);

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

  // Photobooth settings from shared context
  const {
    autoCount, setAutoCount,
    timerDelay, setTimerDelay,
    delayBetweenPhotos, setDelayBetweenPhotos,
    photoReviewTime, setPhotoReviewTime,
    workingFolder, setWorkingFolder,
    currentSession,
    sessions,
    refreshSessions,
    createNewSession,
    loadSession,
    setCurrentSession,
    isLoadingSessions
  } = usePhotoboothSettings();
  const [imageQualityExpanded, setImageQualityExpanded] = useState(false);
  const [focusSettingsExpanded, setFocusSettingsExpanded] = useState(false);

  // Custom Set selection
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [customSets, setCustomSets] = useState<CustomSet[]>([]);
  const [loadingSets, setLoadingSets] = useState(false);
  const [expandedSetIds, setExpandedSetIds] = useState<Set<string>>(new Set());

  // Load custom sets on mount
  useEffect(() => {
    loadCustomSets();
  }, []);

  // Refresh sessions when working folder changes
  useEffect(() => {
    if (workingFolder) {
      refreshSessions();
    }
  }, [workingFolder]);

  const loadCustomSets = async () => {
    try {
      setLoadingSets(true);
      const previews = await invoke<CustomSetPreview[]>('load_custom_sets');
      // Load full set data for each preview
      const fullSets = await Promise.all(
        previews.map(async (preview) => {
          try {
            return await invoke<CustomSet>('get_custom_set', { setId: preview.id });
          } catch {
            return null;
          }
        })
      );
      setCustomSets(fullSets.filter((s): s is CustomSet => s !== null));
    } catch (error) {
      console.error('Failed to load custom sets:', error);
    } finally {
      setLoadingSets(false);
    }
  };

  const toggleSetExpanded = (setId: string) => {
    setExpandedSetIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(setId)) {
        newSet.delete(setId);
      } else {
        newSet.add(setId);
      }
      return newSet;
    });
  };

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
        setWorkingFolder(selected);
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
    // Convert display value (e.g., "Auto 1") to camera value (e.g., "-1")
    const displayValue = isoOptions[value];
    const cameraValue = cameraSettingsService.convertIsoToCamera(displayValue);
    debouncedSetSetting('iso', 'iso', cameraValue);
  };

  const handleSetEvIndex = (value: number) => {
    setEvIndex(value);
    // API call handled on commit (when user releases slider), not during drag
  };

  const handleSetWbValue = (value: string) => {
    setWbValue(value);
    debouncedSetSetting('wb', 'whitebalance', value);
  };

  const handleSetMeteringValue = (value: string) => {
    setMeteringValue(value);
    // Use the camera service to send metering command (handles brand-specific mapping)
    const meteringSetting = cameraSettingsService.getMeteringSettingName();
    if (cameraSettingsService.getBrand().id === 'fuji') {
      // Fuji: map UI value to camera value (must match actual gphoto2 choices exactly)
      const fujiMeteringMap: Record<string, string> = {
        'Evaluative': 'Multi Spot',
        'Partial': 'Center Spot',
        'Spot': 'Average',
        'Center-Weighted': 'Center Weighted',
      };
      debouncedSetSetting('metering', meteringSetting, fujiMeteringMap[value] || value);
    } else {
      debouncedSetSetting('metering', meteringSetting, value);
    }
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
    // console.log('[PhotoboothSidebar] WebSocket status received:', data); // Verbose - disabled
    const opts = optionsRef.current;

    if (data.iso && opts.isoOptions.length > 0) {
      // Convert camera ISO value (e.g., "-1") to display value (e.g., "Auto 1") before lookup
      const displayIso = cameraSettingsService.convertIsoToDisplay(data.iso);
      const idx = opts.isoOptions.findIndex(opt => opt === displayIso);
      if (idx !== -1) {
        confirmSettingValue('iso', displayIso);
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
      // console.log('[PhotoboothSidebar] EV update received:', data.ev, 'options:', opts.evOptions); // Verbose - disabled
      // Use service to map EV value to index (handles brand-specific conversions)
      const idx = cameraSettingsService.mapEvToIndex(data.ev, opts.evOptions);
      // console.log('[PhotoboothSidebar] EV index:', idx); // Verbose - disabled
      if (idx !== -1) {
        confirmSettingValue('ev', opts.evOptions[idx]);
        setEvIndex(idx);
      } else {
        console.warn('[PhotoboothSidebar] EV value could not be mapped:', data.ev);
      }
    } else {
      console.log('[PhotoboothSidebar] EV update: data.ev=', data.ev, 'opts.evOptions.length=', opts.evOptions.length);
    }
    if (data.wb) {
      // Convert camera WB value to display label (e.g., "Automatic" -> "Auto")
      const displayWb = cameraSettingsService.convertWhiteBalanceToDisplay(data.wb);
      confirmSettingValue('wb', displayWb);
      setWbValue(displayWb);
    }
    if (data.metering) {
      // Convert camera metering value to display value (e.g., Fuji "Multi" -> "Evaluative")
      const displayMetering = cameraSettingsService.convertMeteringToDisplay(data.metering);
      setMeteringValue(displayMetering);
    }
  }, [confirmSettingValue]);

  useEffect(() => {
    addStatusListener(handleWsStatus);
    return () => removeStatusListener(handleWsStatus);
  }, [handleWsStatus, addStatusListener, removeStatusListener]);

  // Handle camera options loaded from camera config
  // Memoized with useCallback to prevent WebSocket reconnection loops
  const handleCameraOptionsLoaded = useCallback((options: { iso: string[]; aperture: string[]; shutterspeed: string[]; whitebalance: string[]; ev?: string[] }) => {
    console.log('Camera options loaded:', options);
    setCameraApertureOptions(options.aperture);
    setCameraIsoOptions(options.iso);
    setCameraShutterOptions(options.shutterspeed);
    setCameraWbOptions(options.whitebalance);
    // Use brand-specific EV choices (e.g., '5010' for Fuji, 'exposurecompensation' for Canon)
    if (options.ev && options.ev.length > 0) {
      setCameraEvOptions(options.ev);
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
        <h2 className="sidebar-title">Control Center</h2>

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
              Photobooth
            </button>
          </div>

          <div className="photobooth-tab-content">
            {/* Camera Tab - Always mounted, hidden when not active to preserve state */}
            <div className="tab-panel" style={{ display: activeTab === 'camera' ? 'flex' : 'none' }}>
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
                onSetMeteringValue={handleSetMeteringValue}
                onSetActiveSetting={setActiveSetting}
                onCameraOptionsLoaded={handleCameraOptionsLoaded}
                pendingSettings={pendingSettings}
                onConnectionChange={handleConnectionChange}
              />

              {/* Live View, Image Quality, and Focus Settings - Only show when camera is selected AND connected */}
              {hasSelectedCamera && isCameraConnected && (
                <>
                  {/* Live View Section */}
                  <LiveViewSection
                    expandedSections={expandedSections}
                    toggleSection={toggleSection}
                  />

                  {/* Image Quality Section */}
                  <ImageQuality
                    isExpanded={imageQualityExpanded}
                    onToggle={() => setImageQualityExpanded(!imageQualityExpanded)}
                    cameraConnected={isCameraConnected}
                  />

                  {/* Focus Settings Section */}
                  <FocusSettings
                    isExpanded={focusSettingsExpanded}
                    onToggle={() => setFocusSettingsExpanded(!focusSettingsExpanded)}
                    cameraConnected={isCameraConnected}
                  />
                </>
              )}
            </div>

            {/* Photobooth Settings Tab - Always mounted, hidden when not active */}
            <div className="tab-panel" style={{ display: activeTab === 'settings' ? 'flex' : 'none' }}>
                {/* Custom Set Selection Section */}
                <div className="collapsible-section">
                  <button
                    className="collapsible-header"
                    onClick={() => toggleSection('frame')}
                  >
                    <div className="collapsible-header-left">
                      {expandedSections.frame ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span className="collapsible-title">Select Set</span>
                    </div>
                    {selectedSetId && (
                      <span className="collapsible-badge">
                        {customSets.find(s => s.id === selectedSetId)?.name}
                      </span>
                    )}
                  </button>
                  {expandedSections.frame && (
                    <div className="collapsible-content">
                      {loadingSets ? (
                        <div className="custom-sets-loading">Loading sets...</div>
                      ) : customSets.length === 0 ? (
                        <div className="custom-sets-empty-state">
                          <p>No custom sets found.</p>
                          <p className="custom-sets-hint">Create sets in Collage Creator to use them here.</p>
                        </div>
                      ) : (
                        <div className="custom-set-list">
                          {customSets.map((set) => (
                            <div
                              key={set.id}
                              className={`custom-set-item ${selectedSetId === set.id ? 'selected' : ''} ${expandedSetIds.has(set.id) ? 'expanded' : ''}`}
                            >
                              <button
                                className="custom-set-item-header"
                                onClick={() => toggleSetExpanded(set.id)}
                              >
                                <div className="custom-set-item-left">
                                  {expandedSetIds.has(set.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                  <span className="custom-set-item-name">{set.name}</span>
                                </div>
                                <div className="custom-set-item-right">
                                  <span className="custom-set-zones-badge">{set.frame.zones.length} zones</span>
                                  {selectedSetId === set.id && (
                                    <div className="custom-set-check">
                                      <Check size={12} />
                                    </div>
                                  )}
                                </div>
                              </button>
                              {expandedSetIds.has(set.id) && (
                                <div className="custom-set-item-details">
                                  <div className="custom-set-preview-area">
                                    {set.thumbnail ? (
                                      <img src={convertFileSrc(set.thumbnail.replace('asset://', ''))} alt={set.name} />
                                    ) : (
                                      <div className="custom-set-no-preview">
                                        <Layers size={24} />
                                        <span>No preview</span>
                                      </div>
                                    )}
                                  </div>
                                  <div className="custom-set-info">
                                    <div className="custom-set-detail-row">
                                      <span className="detail-label">Canvas</span>
                                      <span className="detail-value">{set.canvasSize.width} × {set.canvasSize.height}</span>
                                    </div>
                                    <div className="custom-set-detail-row">
                                      <span className="detail-label">Frame</span>
                                      <span className="detail-value">{set.frame.name}</span>
                                    </div>
                                    {set.description && (
                                      <div className="custom-set-detail-row">
                                        <span className="detail-label">Note</span>
                                        <span className="detail-value">{set.description}</span>
                                      </div>
                                    )}
                                    <button
                                      className="custom-set-use-btn"
                                      onClick={() => setSelectedSetId(set.id)}
                                    >
                                      {selectedSetId === set.id ? 'Selected' : 'Use This Set'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

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
                          {workingFolder || 'No folder selected'}
                        </span>
                      </div>
                      <button className="folder-browse-btn" onClick={handleBrowseFolder}>
                        Browse...
                      </button>
                    </div>
                  )}
                </div>

                {/* Session Management Section */}
                <div className="collapsible-section">
                  <button
                    className="collapsible-header"
                    onClick={() => toggleSection('session')}
                  >
                    <div className="collapsible-header-left">
                      {expandedSections.session ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span className="collapsible-title">Sessions</span>
                    </div>
                    {currentSession && (
                      <span className="collapsible-badge">
                        {currentSession.shotCount} photos
                      </span>
                    )}
                  </button>
                  {expandedSections.session && (
                    <div className="collapsible-content">
                      {!workingFolder ? (
                        <div className="session-empty-state">
                          <p>Select a working folder first to manage sessions.</p>
                        </div>
                      ) : (
                        <>
                          {/* Current Session Info */}
                          {currentSession && (
                            <div className="current-session-info">
                              <div className="session-info-header">
                                <span className="session-info-title">Current Session</span>
                                <span className="session-info-name">{currentSession.name}</span>
                              </div>
                              <div className="session-info-stats">
                                <div className="session-stat">
                                  <ImageIcon size={12} />
                                  <span>{currentSession.shotCount} photos</span>
                                </div>
                                <div className="session-stat">
                                  <FolderOpen size={12} />
                                  <span>{currentSession.id}</span>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Create New Session Button */}
                          <button
                            className="create-session-btn"
                            onClick={async () => {
                              try {
                                const defaultName = workingFolder ? workingFolder.split(/[/\\]/).pop() || 'Session' : 'Session';
                                const timestamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                                await createNewSession(`${defaultName} ${timestamp}`);
                              } catch (error) {
                                console.error('Failed to create session:', error);
                              }
                            }}
                          >
                            <Plus size={14} />
                            <span>New Session</span>
                          </button>

                          {/* Session List */}
                          <div className="session-list">
                            {isLoadingSessions ? (
                              <div className="sessions-loading">Loading sessions...</div>
                            ) : sessions.length === 0 ? (
                              <div className="sessions-empty">
                                <p>No sessions yet</p>
                                <p className="sessions-empty-hint">Create a session to start capturing photos</p>
                              </div>
                            ) : (
                              sessions.map((session) => (
                                <div
                                  key={session.id}
                                  className={`session-item ${currentSession?.id === session.id ? 'active' : ''}`}
                                  onClick={() => loadSession(session.id)}
                                >
                                  <div className="session-item-left">
                                    <FolderOpen size={14} className={currentSession?.id === session.id ? 'session-icon-active' : ''} />
                                    <div className="session-item-info">
                                      <span className="session-item-name">{session.name}</span>
                                      <span className="session-item-folder">{session.folderName}</span>
                                    </div>
                                  </div>
                                  <div className="session-item-right">
                                    <div className="session-item-stats">
                                      <span className="session-stat-item">
                                        <ImageIcon size={10} />
                                        {session.shotCount}
                                      </span>
                                      <span className="session-stat-item">
                                        <Calendar size={10} />
                                        {new Date(session.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                      </span>
                                    </div>
                                    {currentSession?.id === session.id && (
                                      <div className="session-check">
                                        <Check size={12} />
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </>
                      )}
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

                      {/* Timer Delay Slider - Delay before 1st photo */}
                      <div className="slider-setting">
                        <div className="slider-header">
                          <span className="slider-label">Delay Before 1st Photo</span>
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

                      {/* Delay Between Photos Slider */}
                      <div className="slider-setting">
                        <div className="slider-header">
                          <span className="slider-label">Delay Between Photos</span>
                          <span className="slider-value">{delayBetweenPhotos}s</span>
                        </div>
                        <div className="slider-wrapper">
                          <div className="slider-track-container">
                            <div className="slider-numbers-container">
                              <div
                                className="slider-active-indicator"
                                style={{
                                  left: `${((delayBetweenPhotos - 1) / 9) * 100}%`,
                                  width: '20px',
                                  transform: 'translateX(-50%)'
                                }}
                              />
                              {Array.from({ length: 10 }, (_, i) => i + 1).map((num) => (
                                <span
                                  key={num}
                                  className={`slider-number-marker ${num === delayBetweenPhotos ? 'active' : ''}`}
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
                            value={[delayBetweenPhotos]}
                            onValueChange={(value) => setDelayBetweenPhotos(value[0])}
                            min={1}
                            max={10}
                            step={1}
                          >
                            <Slider.Thumb className="photobooth-slider-thumb" />
                          </Slider.Root>
                        </div>
                      </div>

                      {/* Photo Review Time Slider */}
                      <div className="slider-setting">
                        <div className="slider-header">
                          <span className="slider-label">Photo Review Time</span>
                          <span className="slider-value">{photoReviewTime}s</span>
                        </div>
                        <div className="slider-wrapper">
                          <div className="slider-track-container">
                            <div className="slider-numbers-container">
                              <div
                                className="slider-active-indicator"
                                style={{
                                  left: `${((photoReviewTime - 1) / 9) * 100}%`,
                                  width: '20px',
                                  transform: 'translateX(-50%)'
                                }}
                              />
                              {Array.from({ length: 10 }, (_, i) => i + 1).map((num) => (
                                <span
                                  key={num}
                                  className={`slider-number-marker ${num === photoReviewTime ? 'active' : ''}`}
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
                            value={[photoReviewTime]}
                            onValueChange={(value) => setPhotoReviewTime(value[0])}
                            min={1}
                            max={10}
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
            </div>
          </div>
        </div>
      </div>
  );
}

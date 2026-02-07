import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { ChevronDown, ChevronRight, Check, Layers, FolderOpen, Plus, Calendar, Image as ImageIcon, X, RefreshCw, AlertCircle } from "lucide-react";
import * as Slider from "@radix-ui/react-slider";
import { open } from '@tauri-apps/plugin-dialog';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { CameraSection } from "./CameraSection";
import { LiveViewSection } from "./LiveViewSection";
import { ImageQuality } from "./ImageQuality";
import { FocusSettings } from "./FocusSettings";
import ConnectionLostModal from "../../Modals/ConnectionLostModal";
import { useCamera } from "../../../contexts/CameraContext";
import { useVM } from "../../../contexts/VMContext";
import { usePhotoboothSettings, type PhotoboothSessionInfo } from "../../../contexts/PhotoboothSettingsContext";
import { useToast } from "../../../contexts/ToastContext";
import type { CameraStatus } from "../../../services/cameraWebSocket";
import type { ConnectionState } from "../../../types/connection";
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

// VM Log Entry type
interface VmLogEntry {
  timestamp: string;
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
}

export default function PhotoboothSidebar(props: PhotoboothSidebarProps) {
  const {
    addStatusListener,
    removeStatusListener,
    isCameraConnected,
    connectionState,
    reconnect,
    disconnect,
  } = useCamera();
  const { isVmOnline } = useVM();
  const { showToast } = useToast();

  // VM Logs modal state
  const [showVmLogs, setShowVmLogs] = useState(false);
  const [vmLogs, setVmLogs] = useState<VmLogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);

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

  // Store last received camera status to apply when options are loaded
  const lastCameraStatusRef = useRef<CameraStatus | null>(null);
  // Track if we're initializing from config (to ignore WebSocket status during init)
  const isInitializingFromConfigRef = useRef(false);

  // Handle connection change callback from CameraSection
  const handleConnectionChange = useCallback((isConnected: boolean, hasSelected: boolean) => {
    console.log('[PhotoboothSidebar] Connection change:', isConnected, hasSelected);
    setHasSelectedCamera(hasSelected);
  }, []);

  // Show toast on reconnection success
  const previousConnectionStateRef = useRef<ConnectionState>('NC');
  useEffect(() => {
    if (connectionState !== previousConnectionStateRef.current) {
      if (connectionState === 'Connected' && previousConnectionStateRef.current === 'Reconnecting') {
        showToast('Reconnected successfully!', 'success', 3000);
      }
      previousConnectionStateRef.current = connectionState;
    }
  }, [connectionState, showToast]);

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

  // Fetch VM logs from file via Tauri
  const fetchVmLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    setLogsError(null);

    try {
      const response = await invoke<{ logs: string[]; lineCount: number }>('get_vm_logs', {
        lines: 100,
      });

      // Parse logs into structured format
      const parsedLogs: VmLogEntry[] = response.logs.map((log) => {
        // Try to parse log level from message
        let level: VmLogEntry['level'] = 'info';
        if (log.toLowerCase().includes('error') || log.toLowerCase().includes('failed')) {
          level = 'error';
        } else if (log.toLowerCase().includes('warning') || log.toLowerCase().includes('warn')) {
          level = 'warning';
        } else if (log.toLowerCase().includes('success') || log.toLowerCase().includes('connected')) {
          level = 'success';
        }

        return {
          timestamp: '', // Log file doesn't include timestamps, could add if needed
          level,
          message: log,
        };
      });

      setVmLogs(parsedLogs);
    } catch (error) {
      console.error('Failed to fetch VM logs:', error);
      setLogsError(error instanceof Error ? error.message : 'Failed to fetch logs');
      setVmLogs([]);
    } finally {
      setIsLoadingLogs(false);
    }
  }, []);

  // Open VM logs modal and fetch logs
  const handleOpenVmLogs = () => {
    setShowVmLogs(true);
    fetchVmLogs();
  };

  // Auto-refresh logs every 3 seconds when modal is open
  useEffect(() => {
    if (showVmLogs) {
      const interval = setInterval(fetchVmLogs, 3000);
      return () => clearInterval(interval);
    }
  }, [showVmLogs, fetchVmLogs]);

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
    // Store the last status for later use when options are loaded
    lastCameraStatusRef.current = data;

    // If we're initializing from config, ignore WebSocket status for a brief period
    // The config values are the source of truth during initialization
    if (isInitializingFromConfigRef.current) {
      console.log('[PhotoboothSidebar] Ignoring WebSocket status during config initialization');
      return;
    }

    console.log('[PhotoboothSidebar] WebSocket status received:', data);
    const opts = optionsRef.current;
    // console.log('[PhotoboothSidebar] Current options - iso:', opts.isoOptions.length, 'aperture:', opts.apertureOptions.length, 'shutter:', opts.shutterSpeeds.length);

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
      //console.log('[PhotoboothSidebar] EV update: data.ev=', data.ev, 'opts.evOptions.length=', opts.evOptions.length);
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
  const handleCameraOptionsLoaded = useCallback((
    options: { iso: string[]; aperture: string[]; shutterspeed: string[]; whitebalance: string[]; ev?: string[] },
    skipStatusApply: boolean = false,
    initialConfigValues?: { shutter?: string; aperture?: string; iso?: string; ev?: string; wb?: string; metering?: string; battery?: string }
  ) => {
    console.log('Camera options loaded:', options, 'skipStatusApply:', skipStatusApply, 'initialConfigValues:', initialConfigValues);
    setCameraApertureOptions(options.aperture);
    setCameraIsoOptions(options.iso);
    setCameraShutterOptions(options.shutterspeed);
    setCameraWbOptions(options.whitebalance);
    // Use brand-specific EV choices (e.g., '5010' for Fuji, 'exposurecompensation' for Canon)
    if (options.ev && options.ev.length > 0) {
      setCameraEvOptions(options.ev);
    }

    // If skipping status apply, use the provided initial config values
    if (skipStatusApply) {
      if (initialConfigValues) {
        console.log('[handleCameraOptionsLoaded] Applying initial config values:', initialConfigValues);

        // Set flag to ignore WebSocket status during initialization
        isInitializingFromConfigRef.current = true;
        setTimeout(() => {
          isInitializingFromConfigRef.current = false;
          console.log('[PhotoboothSidebar] Config initialization complete, WebSocket status will be processed again');
        }, 500);

        if (initialConfigValues.shutter && options.shutterspeed.length > 0) {
          const idx = options.shutterspeed.findIndex(opt => opt === initialConfigValues.shutter);
          if (idx !== -1) {
            setShutterValue(idx);
            console.log('Set shutter from config value:', idx, initialConfigValues.shutter);
          }
        }
        if (initialConfigValues.aperture && options.aperture.length > 0) {
          const idx = options.aperture.findIndex(opt => opt === initialConfigValues.aperture);
          if (idx !== -1) {
            setApertureIndex(idx);
            console.log('Set aperture from config value:', idx, initialConfigValues.aperture);
          }
        }
        if (initialConfigValues.iso && options.iso.length > 0) {
          const displayIso = cameraSettingsService.convertIsoToDisplay(initialConfigValues.iso);
          const idx = options.iso.findIndex(opt => opt === displayIso);
          if (idx !== -1) {
            setIsoIndex(idx);
            console.log('Set ISO from config value:', idx, displayIso);
          }
        }
        if (initialConfigValues.ev && options.ev && options.ev.length > 0) {
          const idx = cameraSettingsService.mapEvToIndex(initialConfigValues.ev, options.ev);
          if (idx !== -1) {
            setEvIndex(idx);
            console.log('Set EV from config value:', idx, options.ev[idx]);
          }
        }
        if (initialConfigValues.wb) {
          const displayWb = cameraSettingsService.convertWhiteBalanceToDisplay(initialConfigValues.wb);
          setWbValue(displayWb);
          console.log('Set WB from config value:', displayWb);
        }
        if (initialConfigValues.metering) {
          const displayMetering = cameraSettingsService.convertMeteringToDisplay(initialConfigValues.metering);
          setMeteringValue(displayMetering);
          console.log('Set metering from config value:', displayMetering);
        }
      }
      return;
    }

    // Only apply status values if we're not skipping (when we have fresh config values coming)
    // Apply values from the last received status instead of defaults
    const lastStatus = lastCameraStatusRef.current;
    if (lastStatus) {
      console.log('[handleCameraOptionsLoaded] Last status available, applying:', lastStatus);

      if (lastStatus.iso && options.iso.length > 0) {
        const displayIso = cameraSettingsService.convertIsoToDisplay(lastStatus.iso);
        const idx = options.iso.findIndex(opt => opt === displayIso);
        if (idx !== -1) {
          setIsoIndex(idx);
          console.log('Set ISO index from status:', idx, displayIso);
        }
      }
      if (lastStatus.aperture && options.aperture.length > 0) {
        const idx = options.aperture.findIndex(opt => opt === lastStatus.aperture);
        if (idx !== -1) {
          setApertureIndex(idx);
          console.log('Set aperture index from status:', idx, lastStatus.aperture);
        }
      }
      if (lastStatus.shutter && options.shutterspeed.length > 0) {
        const idx = options.shutterspeed.findIndex(opt => opt === lastStatus.shutter);
        if (idx !== -1) {
          setShutterValue(idx);
          console.log('Set shutter index from status:', idx, lastStatus.shutter);
        }
      }
      if (lastStatus.ev && options.ev && options.ev.length > 0) {
        const idx = cameraSettingsService.mapEvToIndex(lastStatus.ev, options.ev);
        if (idx !== -1) {
          setEvIndex(idx);
          console.log('Set EV index from status:', idx, options.ev[idx]);
        }
      }
      if (lastStatus.wb) {
        const displayWb = cameraSettingsService.convertWhiteBalanceToDisplay(lastStatus.wb);
        setWbValue(displayWb);
        console.log('Set WB from status:', displayWb);
      }
      if (lastStatus.metering) {
        const displayMetering = cameraSettingsService.convertMeteringToDisplay(lastStatus.metering);
        setMeteringValue(displayMetering);
        console.log('Set metering from status:', displayMetering);
      }
    } else {
      // No status received yet, use safe defaults
      console.log('No last status available, using defaults');
      setApertureIndex(0);
      setIsoIndex(2);
      if (options.shutterspeed.length > 0) {
        setShutterValue(Math.floor(options.shutterspeed.length / 2));
      }
    }
  }, []);

  // Handle initial config values loaded from camera (for setting dial positions)
  const handleConfigValuesLoaded = useCallback((values: { shutter?: string; aperture?: string; iso?: string; ev?: string; wb?: string; metering?: string; battery?: string }) => {
    console.log('[PhotoboothSidebar] Config values loaded:', values);

    // Set flag to ignore WebSocket status during initialization (shorter timeout to allow quicker updates)
    isInitializingFromConfigRef.current = true;

    // Clear the flag after a short delay to allow WebSocket status to resume
    setTimeout(() => {
      isInitializingFromConfigRef.current = false;
      console.log('[PhotoboothSidebar] Config initialization complete, WebSocket status will be processed again');
    }, 500); // Reduced from 2000ms to 500ms

    // Get current options
    const opts = {
      shutterSpeeds,
      apertureOptions,
      isoOptions,
      evOptions,
    };

    // Apply values based on current options
    if (values.shutter && opts.shutterSpeeds.length > 0) {
      const idx = opts.shutterSpeeds.findIndex(opt => opt === values.shutter);
      if (idx !== -1) {
        setShutterValue(idx);
        console.log('Set shutter from config value:', idx, values.shutter);
      }
    }
    if (values.aperture && opts.apertureOptions.length > 0) {
      const idx = opts.apertureOptions.findIndex(opt => opt === values.aperture);
      if (idx !== -1) {
        setApertureIndex(idx);
        console.log('Set aperture from config value:', idx, values.aperture);
      }
    }
    if (values.iso && opts.isoOptions.length > 0) {
      const displayIso = cameraSettingsService.convertIsoToDisplay(values.iso);
      const idx = opts.isoOptions.findIndex(opt => opt === displayIso);
      if (idx !== -1) {
        setIsoIndex(idx);
        console.log('Set ISO from config value:', idx, displayIso);
      }
    }
    if (values.ev && opts.evOptions.length > 0) {
      const idx = cameraSettingsService.mapEvToIndex(values.ev, opts.evOptions);
      if (idx !== -1) {
        setEvIndex(idx);
        console.log('Set EV from config value:', idx, opts.evOptions[idx]);
      }
    }
    if (values.wb) {
      const displayWb = cameraSettingsService.convertWhiteBalanceToDisplay(values.wb);
      setWbValue(displayWb);
      console.log('Set WB from config value:', displayWb);
    }
    if (values.metering) {
      const displayMetering = cameraSettingsService.convertMeteringToDisplay(values.metering);
      setMeteringValue(displayMetering);
      console.log('Set metering from config value:', displayMetering);
    }
  }, [shutterSpeeds, apertureOptions, isoOptions, evOptions]);

  return (
    <>
    <div className="photobooth-sidebar">
      <div className="sidebar">
        <div className="sidebar-title-row">
          <h2 className="sidebar-title">Control Center</h2>
          <div
            className={`vm-status-led ${isVmOnline ? 'online' : 'offline'}`}
            title={`Linux VM is ${isVmOnline ? 'online (click for logs)' : 'offline (click for logs)'}`}
            onClick={handleOpenVmLogs}
          >
            <div className="vm-status-led-inner" />
          </div>
        </div>

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
                onConfigValuesLoaded={handleConfigValuesLoaded}
              />

              {/* Live View, Image Quality, and Focus Settings - Only show when camera is selected AND connected */}
              {(() => {
                //console.log('[PhotoboothSidebar] Rendering check - hasSelectedCamera:', hasSelectedCamera, 'isCameraConnected:', isCameraConnected);
                return hasSelectedCamera && isCameraConnected;
              })() && (
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

      {/* Connection Lost Modal */}
      <ConnectionLostModal
        show={connectionState === 'Reconnecting'}
        onReconnect={reconnect}
        onDisconnect={disconnect}
      />

      {/* VM Logs Modal */}
      {showVmLogs && (
        <div className="vm-logs-modal-overlay" onClick={() => setShowVmLogs(false)}>
          <div className="vm-logs-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vm-logs-modal-header">
              <h3 className="vm-logs-modal-title">
                <div className={`vm-logs-status-indicator ${isVmOnline ? 'online' : 'offline'}`} />
                Linux VM Logs
              </h3>
              <button className="vm-logs-modal-close" onClick={() => setShowVmLogs(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="vm-logs-modal-body">
              {logsError ? (
                <div className="vm-logs-error">
                  <AlertCircle size={32} />
                  <span>{logsError}</span>
                </div>
              ) : isLoadingLogs && vmLogs.length === 0 ? (
                <div className="vm-logs-empty">Loading logs...</div>
              ) : vmLogs.length === 0 ? (
                <div className="vm-logs-empty">No logs available</div>
              ) : (
                <div className="vm-logs-content">
                  {vmLogs.map((log, index) => (
                    <div key={index} className="vm-logs-entry">
                      {log.timestamp && <span className="vm-logs-timestamp">{log.timestamp}</span>}
                      <span className={`vm-logs-message ${log.level}`}>{log.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="vm-logs-footer">
              <span className="vm-logs-status-text">
                {isVmOnline ? 'Connected' : 'Disconnected'} • {vmLogs.length} entries
              </span>
              <button
                className={`vm-logs-refresh-btn ${isLoadingLogs ? 'spinning' : ''}`}
                onClick={fetchVmLogs}
                disabled={!isVmOnline || isLoadingLogs}
              >
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

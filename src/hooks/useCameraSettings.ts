import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useCamera } from '../contexts/CameraContext';
import { getCameraSettingsService } from '../services/cameraSettingsService';
import type { CameraStatus } from '../services/cameraWebSocket';

const API_BASE = 'http://localhost:58321';
const DEBOUNCE_MS = 500;

const cameraSettingsService = getCameraSettingsService();

// Default shutter speeds (fast to slow)
const defaultShutterSpeeds = [
  '1/8000', '1/6400', '1/5000', '1/4000', '1/3200', '1/2500', '1/2000',
  '1/1600', '1/1250', '1/1000', '1/800', '1/640', '1/500', '1/400', '1/320',
  '1/250', '1/200', '1/160', '1/125', '1/100', '1/80', '1/60', '1/50',
  '1/40', '1/30', '1/25', '1/20', '1/15', '1/13', '1/10', '1/8', '1/6',
  '1/5', '1/4', '0.3s', '0.5s', '0.8s', '1s', '1.5s', '2s', '3s', '4s',
  '6s', '8s', '10s', '15s', '20s', '30s'
];

export function useCameraSettings(propsShutterSpeeds?: string[]) {
  const { addStatusListener, removeStatusListener } = useCamera();

  // Setting options - can be updated from camera
  const [cameraApertureOptions, setCameraApertureOptions] = useState<string[]>([]);
  const [cameraIsoOptions, setCameraIsoOptions] = useState<string[]>([]);
  const [cameraShutterOptions, setCameraShutterOptions] = useState<string[]>([]);
  const [cameraWbOptions, setCameraWbOptions] = useState<string[]>([]);
  const [cameraEvOptions, setCameraEvOptions] = useState<string[]>([]);

  // Use camera-provided values or defaults - memoized to prevent WebSocket reconnection
  const shutterSpeeds = useMemo(() =>
    cameraShutterOptions.length > 0 ? cameraShutterOptions : (propsShutterSpeeds || defaultShutterSpeeds),
    [cameraShutterOptions, propsShutterSpeeds]
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
  const [shutterValue, setShutterValue] = useState(-1);
  const [apertureIndex, setApertureIndex] = useState(-1);
  const [isoIndex, setIsoIndex] = useState(-1);
  const [evIndex, setEvIndex] = useState(-1);
  const [wbValue, setWbValue] = useState('');
  const [meteringValue, setMeteringValue] = useState('Evaluative');

  // Pending settings state
  const [pendingSettings, setPendingSettings] = useState<Record<string, string>>({});
  const pendingTimeoutsRef = useRef<Record<string, number>>({});
  const debounceTimeoutsRef = useRef<Record<string, number>>({});

  // Store last received camera status
  const lastCameraStatusRef = useRef<CameraStatus | null>(null);
  const isInitializingFromConfigRef = useRef(false);

  // Send camera setting to API
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

  // Debounced setting helper
  const debouncedSetSetting = (
    pendingKey: string,
    apiSetting: string,
    settingValue: string
  ) => {
    setPendingSettings(prev => ({ ...prev, [pendingKey]: settingValue }));

    if (debounceTimeoutsRef.current[pendingKey]) {
      clearTimeout(debounceTimeoutsRef.current[pendingKey]);
    }
    debounceTimeoutsRef.current[pendingKey] = window.setTimeout(() => {
      sendCameraSetting(apiSetting, settingValue);
    }, DEBOUNCE_MS);

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

  // Wrapper setters
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
    const displayValue = isoOptions[value];
    const cameraValue = cameraSettingsService.convertIsoToCamera(displayValue);
    debouncedSetSetting('iso', 'iso', cameraValue);
  };

  const handleSetEvIndex = (value: number) => {
    setEvIndex(value);
  };

  const handleSetWbValue = (value: string) => {
    setWbValue(value);
    debouncedSetSetting('wb', 'whitebalance', value);
  };

  const handleSetMeteringValue = (value: string) => {
    setMeteringValue(value);
    const meteringSetting = cameraSettingsService.getMeteringSettingName();
    if (cameraSettingsService.getBrand().id === 'fuji') {
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

  // Confirm setting value
  const confirmSettingValue = useCallback((setting: string, actualValue: string) => {
    setPendingSettings(prev => {
      if (prev[setting] === actualValue) {
        if (pendingTimeoutsRef.current[setting]) {
          clearTimeout(pendingTimeoutsRef.current[setting]);
          delete pendingTimeoutsRef.current[setting];
        }
        const { [setting]: removed, ...rest } = prev;
        return rest;
      }
      return prev;
    });
  }, []);

  // WebSocket status handler
  const optionsRef = useRef({ shutterSpeeds, apertureOptions, isoOptions, evOptions });
  useEffect(() => {
    optionsRef.current = { shutterSpeeds, apertureOptions, isoOptions, evOptions };
  }, [shutterSpeeds, apertureOptions, isoOptions, evOptions]);

  const handleWsStatus = useCallback((data: CameraStatus) => {
    lastCameraStatusRef.current = data;

    if (isInitializingFromConfigRef.current) {
      console.log('[useCameraSettings] Ignoring WebSocket status during config initialization');
      return;
    }

    console.log('[useCameraSettings] WebSocket status received:', data);
    const opts = optionsRef.current;

    if (data.iso && opts.isoOptions.length > 0) {
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
      const idx = cameraSettingsService.mapEvToIndex(data.ev, opts.evOptions);
      if (idx !== -1) {
        confirmSettingValue('ev', opts.evOptions[idx]);
        setEvIndex(idx);
      }
    }
    if (data.wb) {
      const displayWb = cameraSettingsService.convertWhiteBalanceToDisplay(data.wb);
      confirmSettingValue('wb', displayWb);
      setWbValue(displayWb);
    }
    if (data.metering) {
      const displayMetering = cameraSettingsService.convertMeteringToDisplay(data.metering);
      setMeteringValue(displayMetering);
    }
  }, [confirmSettingValue]);

  useEffect(() => {
    addStatusListener(handleWsStatus);
    return () => removeStatusListener(handleWsStatus);
  }, [handleWsStatus, addStatusListener, removeStatusListener]);

  // Handle camera options loaded
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
    if (options.ev && options.ev.length > 0) {
      setCameraEvOptions(options.ev);
    }

    if (skipStatusApply) {
      if (initialConfigValues) {
        console.log('[handleCameraOptionsLoaded] Applying initial config values:', initialConfigValues);
        isInitializingFromConfigRef.current = true;
        setTimeout(() => {
          isInitializingFromConfigRef.current = false;
        }, 500);

        if (initialConfigValues.shutter && options.shutterspeed.length > 0) {
          const idx = options.shutterspeed.findIndex(opt => opt === initialConfigValues.shutter);
          if (idx !== -1) setShutterValue(idx);
        }
        if (initialConfigValues.aperture && options.aperture.length > 0) {
          const idx = options.aperture.findIndex(opt => opt === initialConfigValues.aperture);
          if (idx !== -1) setApertureIndex(idx);
        }
        if (initialConfigValues.iso && options.iso.length > 0) {
          const displayIso = cameraSettingsService.convertIsoToDisplay(initialConfigValues.iso);
          const idx = options.iso.findIndex(opt => opt === displayIso);
          if (idx !== -1) setIsoIndex(idx);
        }
        if (initialConfigValues.ev && options.ev && options.ev.length > 0) {
          const idx = cameraSettingsService.mapEvToIndex(initialConfigValues.ev, options.ev);
          if (idx !== -1) setEvIndex(idx);
        }
        if (initialConfigValues.wb) {
          setWbValue(cameraSettingsService.convertWhiteBalanceToDisplay(initialConfigValues.wb));
        }
        if (initialConfigValues.metering) {
          setMeteringValue(cameraSettingsService.convertMeteringToDisplay(initialConfigValues.metering));
        }
      }
      return;
    }

    const lastStatus = lastCameraStatusRef.current;
    if (lastStatus) {
      console.log('[handleCameraOptionsLoaded] Last status available, applying:', lastStatus);
      if (lastStatus.iso && options.iso.length > 0) {
        const displayIso = cameraSettingsService.convertIsoToDisplay(lastStatus.iso);
        const idx = options.iso.findIndex(opt => opt === displayIso);
        if (idx !== -1) setIsoIndex(idx);
      }
      if (lastStatus.aperture && options.aperture.length > 0) {
        const idx = options.aperture.findIndex(opt => opt === lastStatus.aperture);
        if (idx !== -1) setApertureIndex(idx);
      }
      if (lastStatus.shutter && options.shutterspeed.length > 0) {
        const idx = options.shutterspeed.findIndex(opt => opt === lastStatus.shutter);
        if (idx !== -1) setShutterValue(idx);
      }
      if (lastStatus.ev && options.ev && options.ev.length > 0) {
        const idx = cameraSettingsService.mapEvToIndex(lastStatus.ev, options.ev);
        if (idx !== -1) setEvIndex(idx);
      }
      if (lastStatus.wb) {
        setWbValue(cameraSettingsService.convertWhiteBalanceToDisplay(lastStatus.wb));
      }
      if (lastStatus.metering) {
        setMeteringValue(cameraSettingsService.convertMeteringToDisplay(lastStatus.metering));
      }
    } else {
      setApertureIndex(0);
      setIsoIndex(2);
      if (options.shutterspeed.length > 0) {
        setShutterValue(Math.floor(options.shutterspeed.length / 2));
      }
    }
  }, []);

  // Handle config values loaded
  const handleConfigValuesLoaded = useCallback((values: { shutter?: string; aperture?: string; iso?: string; ev?: string; wb?: string; metering?: string; battery?: string }) => {
    console.log('[useCameraSettings] Config values loaded:', values);
    isInitializingFromConfigRef.current = true;
    setTimeout(() => {
      isInitializingFromConfigRef.current = false;
    }, 500);

    const opts = {
      shutterSpeeds,
      apertureOptions,
      isoOptions,
      evOptions,
    };

    if (values.shutter && opts.shutterSpeeds.length > 0) {
      const idx = opts.shutterSpeeds.findIndex(opt => opt === values.shutter);
      if (idx !== -1) setShutterValue(idx);
    }
    if (values.aperture && opts.apertureOptions.length > 0) {
      const idx = opts.apertureOptions.findIndex(opt => opt === values.aperture);
      if (idx !== -1) setApertureIndex(idx);
    }
    if (values.iso && opts.isoOptions.length > 0) {
      const displayIso = cameraSettingsService.convertIsoToDisplay(values.iso);
      const idx = opts.isoOptions.findIndex(opt => opt === displayIso);
      if (idx !== -1) setIsoIndex(idx);
    }
    if (values.ev && opts.evOptions.length > 0) {
      const idx = cameraSettingsService.mapEvToIndex(values.ev, opts.evOptions);
      if (idx !== -1) setEvIndex(idx);
    }
    if (values.wb) {
      setWbValue(cameraSettingsService.convertWhiteBalanceToDisplay(values.wb));
    }
    if (values.metering) {
      setMeteringValue(cameraSettingsService.convertMeteringToDisplay(values.metering));
    }
  }, [shutterSpeeds, apertureOptions, isoOptions, evOptions]);

  return {
    // Options
    shutterSpeeds,
    apertureOptions,
    isoOptions,
    evOptions,
    wbOptions,
    // Values
    shutterValue,
    apertureIndex,
    isoIndex,
    evIndex,
    wbValue,
    meteringValue,
    // Setters
    setShutterValue: handleSetShutterValue,
    setApertureIndex: handleSetApertureIndex,
    setIsoIndex: handleSetIsoIndex,
    setEvIndex: handleSetEvIndex,
    setWbValue: handleSetWbValue,
    setMeteringValue: handleSetMeteringValue,
    // Handlers
    onCameraOptionsLoaded: handleCameraOptionsLoaded,
    onConfigValuesLoaded: handleConfigValuesLoaded,
    // Pending state
    pendingSettings,
  };
}

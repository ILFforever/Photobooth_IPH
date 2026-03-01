import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

interface CaptureDevice {
  name: string;
}

export interface HdmiCaptureState {
  devices: CaptureDevice[];
  isLoadingDevices: boolean;
  isCapturing: boolean;
  frameUrl: string | null;
  selectedDevice: string | null;
  error: string | null;
  loadDevices: () => Promise<void>;
  startCapture: (deviceName: string) => Promise<void>;
  stopCapture: () => Promise<void>;
  setSelectedDevice: (deviceName: string) => void;
}

function base64ToBlob(b64: string, mime: string): Blob {
  const byteChars = atob(b64);
  const byteArray = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteArray[i] = byteChars.charCodeAt(i);
  }
  return new Blob([byteArray], { type: mime });
}

export function useHdmiCapture(): HdmiCaptureState {
  const [devices, setDevices] = useState<CaptureDevice[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [selectedDevice, setSelectedDeviceState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const capturingRef = useRef(false);
  const prevUrlRef = useRef<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const frameCountRef = useRef(0);

  // Cleanup blob URLs and event listener on unmount
  useEffect(() => {
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      if (prevUrlRef.current) {
        URL.revokeObjectURL(prevUrlRef.current);
        prevUrlRef.current = null;
      }
    };
  }, []);

  const startListening = useCallback(async () => {
    // Clean up previous listener
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }

    frameCountRef.current = 0;

    const unlisten = await listen<string>('hdmi-frame', (event) => {
      const blob = base64ToBlob(event.payload, 'image/jpeg');
      const url = URL.createObjectURL(blob);

      // Revoke previous URL to prevent memory leak
      if (prevUrlRef.current) {
        URL.revokeObjectURL(prevUrlRef.current);
      }
      prevUrlRef.current = url;

      setFrameUrl(url);
    });

    unlistenRef.current = unlisten;
  }, []);

  const stopListening = useCallback(() => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }
    setFrameUrl(null);
  }, []);

  const prevDeviceNamesRef = useRef<string>('');

  const loadDevices = useCallback(async () => {
    const isFirstLoad = prevDeviceNamesRef.current === '';
    if (isFirstLoad) {
      setIsLoadingDevices(true);
    }
    try {
      const result = await invoke<CaptureDevice[]>('list_capture_devices');
      const namesKey = result.map(d => d.name).join('\0');
      if (namesKey !== prevDeviceNamesRef.current) {
        prevDeviceNamesRef.current = namesKey;
        setDevices(result);
        setError(null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Failed to list devices: ${msg}`);
      if (prevDeviceNamesRef.current !== '') {
        prevDeviceNamesRef.current = '';
        setDevices([]);
      }
    } finally {
      if (isFirstLoad) {
        setIsLoadingDevices(false);
      }
    }
  }, []);

  const startCapture = useCallback(async (deviceName: string) => {
    if (capturingRef.current) {
      try {
        await invoke('stop_hdmi_capture');
      } catch { /* ignore */ }
      stopListening();
    }

    setError(null);
    capturingRef.current = true;
    setIsCapturing(true);

    try {
      // Start event listener BEFORE starting capture so we don't miss frames
      await startListening();

      await invoke('start_hdmi_capture', { deviceName });
      setSelectedDeviceState(deviceName);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Capture failed: ${msg}`);
      setIsCapturing(false);
      stopListening();
      capturingRef.current = false;
    }
  }, [startListening, stopListening]);

  const stopCapture = useCallback(async () => {
    stopListening();
    try {
      await invoke('stop_hdmi_capture');
    } catch { /* ignore */ }
    setIsCapturing(false);
    capturingRef.current = false;
  }, [stopListening]);

  const setSelectedDevice = useCallback((deviceName: string) => {
    setSelectedDeviceState(deviceName);
  }, []);

  return {
    devices,
    isLoadingDevices,
    isCapturing,
    frameUrl,
    selectedDevice,
    error,
    loadDevices,
    startCapture,
    stopCapture,
    setSelectedDevice,
  };
}

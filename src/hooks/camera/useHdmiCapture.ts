import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { createLogger } from '../../utils/logger';
const logger = createLogger('useHdmiCapture');

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
  ffmpegRequired: boolean;
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
  const [ffmpegRequired, setFfmpegRequired] = useState(false);
  const capturingRef = useRef(false);
  const prevUrlRef = useRef<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const frameCountRef = useRef(0);
  const mountedRef = useRef(true);

  // Cleanup blob URLs and event listener on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
      // Check if component is still mounted before processing event
      if (!mountedRef.current) return;

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
      // Check if component is still mounted before updating state
      if (!mountedRef.current) return;

      const namesKey = result.map(d => d.name).join('\0');
      if (namesKey !== prevDeviceNamesRef.current) {
        prevDeviceNamesRef.current = namesKey;
        setDevices(result);
        setError(null);
        setFfmpegRequired(false);
      }
    } catch (e) {
      // Check if component is still mounted before updating state
      if (!mountedRef.current) return;

      const msg = e instanceof Error ? e.message : String(e);
      // Check if error is about FFmpeg
      if (msg.includes('FFmpeg not found') || msg.includes('ffmpeg')) {
        setFfmpegRequired(true);
        setError('FFmpeg is required for HDMI capture');
      } else {
        setError(`Failed to list devices: ${msg}`);
        setFfmpegRequired(false);
      }
      // Use sentinel (not '') so next loadDevices call won't show loading spinner
      if (prevDeviceNamesRef.current !== '__error__') {
        prevDeviceNamesRef.current = '__error__';
        setDevices([]);
      }
    } finally {
      // Check if component is still mounted before updating state
      if (mountedRef.current && isFirstLoad) {
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
    setFfmpegRequired(false);
    capturingRef.current = true;
    setIsCapturing(true);

    try {
      // Start event listener BEFORE starting capture so we don't miss frames
      await startListening();

      await invoke('start_hdmi_capture', { deviceName });
      setSelectedDeviceState(deviceName);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Check if error is about FFmpeg
      if (msg.includes('FFmpeg not found') || msg.includes('ffmpeg')) {
        setFfmpegRequired(true);
        setError('FFmpeg is required for HDMI capture');
      } else {
        setError(`Capture failed: ${msg}`);
      }
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
    ffmpegRequired,
    loadDevices,
    startCapture,
    stopCapture,
    setSelectedDevice,
  };
}

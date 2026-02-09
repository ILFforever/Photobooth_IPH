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
    console.log('[useHdmiCapture] Starting event listener for hdmi-frame');

    const unlisten = await listen<string>('hdmi-frame', (event) => {
      frameCountRef.current++;
      if (frameCountRef.current === 1) {
        console.log('[useHdmiCapture] ✓ First frame received via event, b64 length:', event.payload.length);
      } else if (frameCountRef.current % 100 === 0) {
        //console.log('[useHdmiCapture] Frames received:', frameCountRef.current);
      }

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
      console.log('[useHdmiCapture] Stopping event listener');
      unlistenRef.current();
      unlistenRef.current = null;
    }
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }
    setFrameUrl(null);
  }, []);

  const loadDevices = useCallback(async () => {
    console.log('[useHdmiCapture] loadDevices called');
    setIsLoadingDevices(true);
    setError(null);
    try {
      const result = await invoke<CaptureDevice[]>('list_capture_devices');
      console.log('[useHdmiCapture] loadDevices result:', result);
      setDevices(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[useHdmiCapture] loadDevices error:', msg);
      setError(`Failed to list devices: ${msg}`);
      setDevices([]);
    } finally {
      setIsLoadingDevices(false);
    }
  }, []);

  const startCapture = useCallback(async (deviceName: string) => {
    console.log('[useHdmiCapture] startCapture called for:', deviceName);
    if (capturingRef.current) {
      console.log('[useHdmiCapture] Already capturing, stopping first...');
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

      console.log('[useHdmiCapture] Invoking start_hdmi_capture with deviceName:', deviceName);
      await invoke('start_hdmi_capture', { deviceName });
      console.log('[useHdmiCapture] ✓ Capture started');
      setSelectedDeviceState(deviceName);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[useHdmiCapture] startCapture error:', msg);
      setError(`Capture failed: ${msg}`);
      setIsCapturing(false);
      stopListening();
      capturingRef.current = false;
    }
  }, [startListening, stopListening]);

  const stopCapture = useCallback(async () => {
    console.log('[useHdmiCapture] stopCapture called, wasCapturing:', capturingRef.current);
    stopListening();
    try {
      await invoke('stop_hdmi_capture');
    } catch { /* ignore */ }
    setIsCapturing(false);
    capturingRef.current = false;
  }, [stopListening]);

  const setSelectedDevice = useCallback((deviceName: string) => {
    console.log('[useHdmiCapture] setSelectedDevice:', deviceName);
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

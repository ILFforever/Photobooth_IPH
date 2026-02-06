import { createContext, useContext, useEffect, useState, useRef, useCallback, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import CameraWebSocketManager, { type CameraStatus, type CaptureErrorEvent, type PhotoDownloadedEvent } from '../services/cameraWebSocket';

interface CameraContextType {
  /** Whether the WebSocket is currently connected */
  isWsConnected: boolean;
  /** Whether a physical camera is connected (detected from status data) */
  isCameraConnected: boolean;
  /** Whether a camera has ever been connected in this session (for showing disconnect warnings) */
  hasEverConnected: boolean;
  /** Whether a camera is currently being connected */
  isConnecting: boolean;
  /** Set the connecting state (used by CameraSection during connection) */
  setConnecting: (connecting: boolean) => void;
  /** Battery level string (e.g. "89") */
  batteryLevel: string | null;
  /** Shooting mode (P, A, S, M) */
  shootingMode: string;
  /** Last raw status from WebSocket */
  lastStatus: CameraStatus | null;
  /** Last capture error (null if no error) */
  captureError: string | null;
  /** Clear the capture error */
  clearCaptureError: () => void;
  /** Register a callback for raw status updates (for settings sync) */
  addStatusListener: (cb: (status: CameraStatus) => void) => void;
  /** Unregister a status callback */
  removeStatusListener: (cb: (status: CameraStatus) => void) => void;
  /** Register a callback for photo_downloaded events */
  addPhotoDownloadedListener: (cb: (event: PhotoDownloadedEvent) => void) => void;
  /** Unregister a photo_downloaded callback */
  removePhotoDownloadedListener: (cb: (event: PhotoDownloadedEvent) => void) => void;
}

const CameraContext = createContext<CameraContextType | null>(null);

export function CameraProvider({ children }: { children: ReactNode }) {
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [batteryLevel, setBatteryLevel] = useState<string | null>(null);
  const [shootingMode, setShootingMode] = useState('M');
  const [lastStatus, setLastStatus] = useState<CameraStatus | null>(null);
  const [isCameraConnected, setIsCameraConnected] = useState(false); // Actual camera connection state
  const [hasEverConnected, setHasEverConnected] = useState(false); // Track if camera ever connected this session
  const [isConnecting, setIsConnecting] = useState(false); // Track when camera is being connected
  const [captureError, setCaptureError] = useState<string | null>(null);

  // External status listeners (for PhotoboothSidebar settings sync)
  const statusListenersRef = useRef<Set<(status: CameraStatus) => void>>(new Set());
  // External photo_downloaded listeners (for PhotoboothWorkspace photo handling)
  const photoDownloadedListenersRef = useRef<Set<(event: PhotoDownloadedEvent) => void>>(new Set());
  // Track previous connection state to detect actual changes
  const wasCameraConnectedRef = useRef(false);
  // Count consecutive empty status messages (to avoid false disconnects during capture)
  const emptyStatusCountRef = useRef(0);
  const DISCONNECT_THRESHOLD = 3; // Require 3 consecutive empty statuses before marking disconnected

  const addStatusListener = useCallback((cb: (status: CameraStatus) => void) => {
    statusListenersRef.current.add(cb);
  }, []);

  const removeStatusListener = useCallback((cb: (status: CameraStatus) => void) => {
    statusListenersRef.current.delete(cb);
  }, []);

  const addPhotoDownloadedListener = useCallback((cb: (event: PhotoDownloadedEvent) => void) => {
    photoDownloadedListenersRef.current.add(cb);
  }, []);

  const removePhotoDownloadedListener = useCallback((cb: (event: PhotoDownloadedEvent) => void) => {
    photoDownloadedListenersRef.current.delete(cb);
  }, []);

  const clearCaptureError = useCallback(() => {
    setCaptureError(null);
  }, []);

  useEffect(() => {
    const manager = CameraWebSocketManager.getInstance();

    // Ensure USB filters are set up for all supported camera brands (runs once on mount)
    invoke('ensure_usb_filters').catch((e) => {
      console.warn('[CameraContext] Failed to ensure USB filters:', e);
    });

    const handleStatus = (data: CameraStatus) => {
      setLastStatus(data);

      // Detect if a real camera is connected based on status data
      // Check for meaningful values (not defaults like empty strings or generic values)
      const hasRealData = Boolean(
        (data.shootingmode && data.shootingmode !== '' && data.shootingmode !== 'undefined') ||
        (data.battery && data.battery !== '' && data.battery !== '0') ||
        (data.iso && data.iso !== '') ||
        (data.aperture && data.aperture !== '') ||
        (data.shutter && data.shutter !== '')
      );

      // Use hysteresis to avoid false disconnects during capture
      // Require multiple consecutive empty statuses before marking as disconnected
      if (hasRealData) {
        emptyStatusCountRef.current = 0;
        if (!wasCameraConnectedRef.current) {
          console.log('[CameraContext] Camera connection state changed: false -> true');
          wasCameraConnectedRef.current = true;
          setIsCameraConnected(true);
          setHasEverConnected(true); // Mark that we've had a camera connection this session
        }
      } else {
        emptyStatusCountRef.current++;
        if (wasCameraConnectedRef.current && emptyStatusCountRef.current >= DISCONNECT_THRESHOLD) {
          console.log('[CameraContext] Camera connection state changed: true -> false (after', emptyStatusCountRef.current, 'empty statuses)');
          wasCameraConnectedRef.current = false;
          setIsCameraConnected(false);
        }
      }

      if (data.shootingmode) {
        setShootingMode(data.shootingmode);
      }
      if (data.battery) {
        setBatteryLevel(data.battery.split(',')[0]);
      }

      // Notify external listeners (e.g. PhotoboothSidebar)
      statusListenersRef.current.forEach(cb => {
        try { cb(data); } catch (e) { console.error('[CameraContext] listener error:', e); }
      });
    };

    const handleConnected = () => {
      console.log('[CameraContext] Camera CONNECTED - WebSocket connected');
      setIsWsConnected(true);
    };
    const handleDisconnected = () => {
      console.log('[CameraContext] Camera DISCONNECTED - WebSocket disconnected');
      setIsWsConnected(false);
    };
    const handleCaptureError = (data: CaptureErrorEvent) => {
      console.error('[CameraContext] Capture error received:', data.error);
      setCaptureError(data.error);
    };
    const handleCameraDisconnected = () => {
      console.log('[CameraContext] Camera physically disconnected');
      wasCameraConnectedRef.current = false;
      setIsCameraConnected(false);
      emptyStatusCountRef.current = 0;
    };
    const handlePhotoDownloaded = (data: PhotoDownloadedEvent) => {
      console.log('[CameraContext] Photo downloaded:', data.file_path);
      // Notify external listeners (e.g. PhotoboothWorkspace)
      photoDownloadedListenersRef.current.forEach(cb => {
        try { cb(data); } catch (e) { console.error('[CameraContext] photo_downloaded listener error:', e); }
      });
    };

    manager.on('status', handleStatus);
    manager.on('connected', handleConnected);
    manager.on('disconnected', handleDisconnected);
    manager.on('capture_error', handleCaptureError);
    manager.on('camera_disconnected', handleCameraDisconnected);
    manager.on('photo_downloaded', handlePhotoDownloaded);
    manager.connect();

    return () => {
      manager.off('status', handleStatus);
      manager.off('connected', handleConnected);
      manager.off('disconnected', handleDisconnected);
      manager.off('capture_error', handleCaptureError);
      manager.off('camera_disconnected', handleCameraDisconnected);
      manager.off('photo_downloaded', handlePhotoDownloaded);
      manager.disconnect();
    };
  }, []);

  return (
    <CameraContext.Provider value={{
      isWsConnected,
      isCameraConnected,
      hasEverConnected,
      isConnecting,
      setConnecting: setIsConnecting,
      batteryLevel,
      shootingMode,
      lastStatus,
      captureError,
      clearCaptureError,
      addStatusListener,
      removeStatusListener,
      addPhotoDownloadedListener,
      removePhotoDownloadedListener,
    }}>
      {children}
    </CameraContext.Provider>
  );
}

export function useCamera() {
  const context = useContext(CameraContext);
  if (!context) {
    throw new Error('useCamera must be used within a CameraProvider');
  }
  return context;
}

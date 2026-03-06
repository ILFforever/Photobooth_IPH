import { createContext, useContext, useEffect, useState, useRef, useCallback, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import CameraWebSocketManager, { type CameraStatus, type CaptureErrorEvent, type PhotoDownloadedEvent } from '../services/cameraWebSocket';
import type { ConnectionState } from '../types/connection';
import { getConnectionStateText } from '../types/connection';

interface CameraContextType {
  /** The current connection state of the control center */
  connectionState: ConnectionState;
  /** Human-readable connection state text */
  connectionStateText: string;
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
  /** Set the camera connected state (called when HTTP API succeeds) */
  setCameraHttpConnected: (connected: boolean, cameraId?: string) => void;
  /** Initiate connection to the control center */
  connect: () => void;
  /** Disconnect from the control center */
  disconnect: () => void;
  /** Reconnect after connection loss — re-establishes WS and re-registers camera */
  reconnect: () => void;
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
  /** Whether a photo is currently being downloaded from the camera */
  isDownloading: boolean;
  /** Set the downloading state (call when capture starts) */
  setDownloading: (downloading: boolean) => void;
  /** Register a callback for raw status updates (for settings sync) */
  addStatusListener: (cb: (status: CameraStatus) => void) => void;
  /** Unregister a status callback */
  removeStatusListener: (cb: (status: CameraStatus) => void) => void;
  /** Register a callback for photo_downloaded events */
  addPhotoDownloadedListener: (cb: (event: PhotoDownloadedEvent) => void) => void;
  /** Unregister a photo_downloaded callback */
  removePhotoDownloadedListener: (cb: (event: PhotoDownloadedEvent) => void) => void;
  /** Camera serial number (from camera_connected event) */
  serialNumber: string | null;
  /** Camera firmware version (from camera_connected event) */
  firmware: string | null;
  /** Whether camera polling is paused */
  isPollingPaused: boolean;
  /** Pause camera polling */
  pausePolling: () => Promise<void>;
  /** Resume camera polling */
  resumePolling: () => Promise<void>;
}

const CameraContext = createContext<CameraContextType | null>(null);

export function CameraProvider({ children }: { children: ReactNode }) {
  // Connection state management
  const [connectionState, setConnectionState] = useState<ConnectionState>('NC');
  const [batteryLevel, setBatteryLevel] = useState<string | null>(null);
  const [shootingMode, setShootingMode] = useState('M');
  const [lastStatus, setLastStatus] = useState<CameraStatus | null>(null);
  const [isCameraConnected, setIsCameraConnected] = useState(false); // Actual camera connection state
  const [hasEverConnected, setHasEverConnected] = useState(false); // Track if camera ever connected this session
  const [isConnecting, setIsConnecting] = useState(false); // Track when camera is being connected
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false); // Track when photo is being downloaded
  const [serialNumber, setSerialNumber] = useState<string | null>(null);
  const [firmware, setFirmware] = useState<string | null>(null);
  const [isPollingPaused, setIsPollingPaused] = useState(false); // Track if camera polling is paused

  // Track WebSocket connection separately for internal logic
  const [isWsConnected, setIsWsConnected] = useState(false);

  // Track if we've received camera status data after WS connection
  const hasReceivedStatusRef = useRef(false);
  // Track if we've successfully connected via HTTP API
  const hasHttpConnectedRef = useRef(false);
  // Track the selected camera ID so we can re-register after WS reconnection
  const selectedCameraIdRef = useRef<string | null>(null);

  // Ref to track current connection state for WebSocket handlers (avoids closure issues)
  const connectionStateRef = useRef<ConnectionState>('NC');
  connectionStateRef.current = connectionState;

  // Ref to track WS connection for use inside event handlers (avoids stale closures)
  const isWsConnectedRef = useRef(false);
  isWsConnectedRef.current = isWsConnected;

  // Connection state machine helpers — ref-stable, reads from connectionStateRef
  const updateConnectionState = useCallback((newState: ConnectionState) => {
    if (newState !== connectionStateRef.current) {
      //logger.debug(`[CameraContext] Connection state: ${connectionStateRef.current} -> ${newState}`);
      connectionStateRef.current = newState; // sync ref immediately for subsequent reads
      setConnectionState(newState);
    }
  }, []);

  // External status listeners (for PhotoboothSidebar settings sync)
  const statusListenersRef = useRef<Set<(status: CameraStatus) => void>>(new Set());
  // External photo_downloaded listeners (for PhotoboothWorkspace photo handling)
  const photoDownloadedListenersRef = useRef<Set<(event: PhotoDownloadedEvent) => void>>(new Set());
  // Track previous connection state to detect actual changes
  const wasCameraConnectedRef = useRef(false);
  // Count consecutive empty status messages (to avoid false disconnects during capture)
  const emptyStatusCountRef = useRef(0);
  const DISCONNECT_THRESHOLD = 3; // Require 3 consecutive empty statuses before marking disconnected (~4.5 seconds)
  // Timeout for download state - auto-clear after 5 seconds if no photo_downloaded event
  const downloadTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  // Set camera connected via HTTP API (when config/status fetch succeeds)
  const setCameraHttpConnected = useCallback((connected: boolean, cameraId?: string) => {
    if (connected && !hasHttpConnectedRef.current) {
      hasHttpConnectedRef.current = true;
      if (cameraId) selectedCameraIdRef.current = cameraId;
      setIsCameraConnected(true);
      setIsConnecting(false);
      setHasEverConnected(true);
    } else if (!connected) {
      hasHttpConnectedRef.current = false;
      selectedCameraIdRef.current = null;
    }
  }, []);

  // Connect function - initiates connection to the control center
  const connect = useCallback(() => {
    CameraWebSocketManager.getInstance().clearIntentionalFlag(); // Clear flag when connecting
    const current = connectionStateRef.current;
    if (current === 'NC' || current === 'Reconnecting') {
      updateConnectionState('Connecting');
    }
    CameraWebSocketManager.getInstance().connect();
  }, [updateConnectionState]);

  // Reconnect after connection loss — re-establishes WS and re-registers camera with daemon
  const reconnect = useCallback(() => {
    updateConnectionState('Connecting');
    CameraWebSocketManager.getInstance().connect();

    // Re-register the camera with the daemon so it resumes polling
    const cameraId = selectedCameraIdRef.current;
    if (cameraId) {
      fetch(`http://localhost:58321/api/controller/switch?camera=${cameraId}`, { method: 'POST' })
        .catch((err) => logger.warn('[CameraContext] Failed to re-register camera:', err));
    }
  }, [updateConnectionState]);

  const disconnect = useCallback(() => {
    connectionStateRef.current = 'NC';
    setConnectionState('NC');
    hasReceivedStatusRef.current = false;
    selectedCameraIdRef.current = null;
    wasCameraConnectedRef.current = false;
    hasHttpConnectedRef.current = false;
    setIsCameraConnected(false);
    setIsDownloading(false);
    setIsConnecting(false);
    setIsPollingPaused(false);
    if (downloadTimeoutRef.current) {
      clearTimeout(downloadTimeoutRef.current);
      downloadTimeoutRef.current = null;
    }
    fetch('http://localhost:58321/api/controller/disconnect', { method: 'POST' })
      .catch(err => logger.warn('[CameraContext] Failed to send disconnect to controller:', err));
    CameraWebSocketManager.getInstance().disconnect();
  }, []);

  // Pause camera polling
  const pausePolling = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:58321/api/controller/pause-polling', { method: 'POST' });
      if (!response.ok) {
        logger.warn('[CameraContext] Failed to pause polling');
      }
    } catch (err) {
      logger.warn('[CameraContext] Failed to send pause polling command:', err);
    }
  }, []);

  // Resume camera polling
  const resumePolling = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:58321/api/controller/resume-polling', { method: 'POST' });
      if (!response.ok) {
        logger.warn('[CameraContext] Failed to resume polling');
      }
    } catch (err) {
      logger.warn('[CameraContext] Failed to send resume polling command:', err);
    }
  }, []);

  useEffect(() => {
    const manager = CameraWebSocketManager.getInstance();

    // USB filters are set up during initialize_app (splash screen) - no need to call again here

    const handleStatus = (data: CameraStatus) => {
      setLastStatus(data);
      hasReceivedStatusRef.current = true;

      const hasRealData = Boolean(
        (data.mode === 'liveview_streaming' || data.mode === 'liveview') ||
        (data.shootingmode && data.shootingmode !== '' && data.shootingmode !== 'undefined') ||
        (data.battery && data.battery !== '' && data.battery !== '0') ||
        (data.iso && data.iso !== '') ||
        (data.aperture && data.aperture !== '') ||
        (data.shutter && data.shutter !== '')
      );

      if (hasRealData) {
        emptyStatusCountRef.current = 0;
        if (!wasCameraConnectedRef.current) {
          wasCameraConnectedRef.current = true;
          setIsCameraConnected(true);
          setHasEverConnected(true);
        }

        const currentState = connectionStateRef.current;
        if (currentState === 'Connecting' || currentState === 'Reconnecting') {
          updateConnectionState('Connected');
        }
      } else {
        const currentState = connectionStateRef.current;
        if (currentState === 'Connecting' && !wasCameraConnectedRef.current) {
          wasCameraConnectedRef.current = true;
          setIsCameraConnected(true);
          setHasEverConnected(true);
          updateConnectionState('Connected');
        }
        emptyStatusCountRef.current++;
        if (wasCameraConnectedRef.current && emptyStatusCountRef.current >= DISCONNECT_THRESHOLD) {
          wasCameraConnectedRef.current = false;
          setIsCameraConnected(false);

          if (isWsConnectedRef.current && (currentState === 'Connected' || currentState === 'Connecting')) {
            updateConnectionState('Reconnecting');
          }
        }
      }

      if (data.shootingmode) {
        setShootingMode(data.shootingmode);
      }
      if (data.battery) {
        setBatteryLevel(data.battery.split(',')[0]);
      }

      statusListenersRef.current.forEach(cb => {
        try { cb(data); } catch (e) { logger.error('[CameraContext] listener error:', e); }
      });
    };

    const handleConnected = () => {
      isWsConnectedRef.current = true;
      setIsWsConnected(true);
    };

    const handleDisconnected = (data?: { intentional?: boolean }) => {
      const isIntentional = data?.intentional === true;
      isWsConnectedRef.current = false;
      setIsWsConnected(false);
      hasReceivedStatusRef.current = false;

      const currentState = connectionStateRef.current;
      if (!isIntentional && (currentState === 'Connected' || currentState === 'Connecting')) {
        updateConnectionState('Reconnecting');
      }
    };

    const handleCaptureError = (data: CaptureErrorEvent) => {
      logger.error('[CameraContext] Capture error:', data.error);
      setCaptureError(data.error);
    };

    const handleCameraDisconnected = () => {
      const isIntentional = CameraWebSocketManager.getInstance().isIntentionalDisconnect();
      wasCameraConnectedRef.current = false;
      setIsCameraConnected(false);
      emptyStatusCountRef.current = 0;

      const currentState = connectionStateRef.current;
      if (!isIntentional && currentState !== 'NC' && (currentState === 'Connected' || currentState === 'Connecting')) {
        updateConnectionState('Reconnecting');
      }
    };

    const handlePhotoDownloaded = (data: PhotoDownloadedEvent) => {
      if (downloadTimeoutRef.current) {
        clearTimeout(downloadTimeoutRef.current);
        downloadTimeoutRef.current = null;
      }
      setIsDownloading(false);
      photoDownloadedListenersRef.current.forEach(cb => {
        try { cb(data); } catch (e) { logger.error('[CameraContext] photo_downloaded listener error:', e); }
      });
    };

    const handleCameraConnecting = (_data: { type: string; camera_id: string }) => {
      setIsConnecting(true);
    };

    const handleCameraConnectFailed = (data: { type: string; camera_id: string; error: string }) => {
      logger.error('[CameraContext] Camera connect failed:', data.error);
      setIsConnecting(false);
    };

    const handleCameraConnected = (data: { type: string; camera_id: string; manufacturer: string; model: string; port: string; usb_version: string; serial_number?: string; firmware?: string }) => {
      logger.debug('[CameraContext] camera_connected event:', JSON.stringify(data));
      setIsConnecting(false);
      setIsCameraConnected(true);
      setHasEverConnected(true);
      if (data.serial_number) setSerialNumber(data.serial_number);
      if (data.firmware) setFirmware(data.firmware);
    };

    const handlePollingPaused = () => {
      logger.debug('[CameraContext] polling_paused event');
      setIsPollingPaused(true);
    };

    const handlePollingResumed = () => {
      logger.debug('[CameraContext] polling_resumed event');
      setIsPollingPaused(false);
    };

    manager.on('status', handleStatus);
    manager.on('connected', handleConnected);
    manager.on('disconnected', handleDisconnected);
    manager.on('capture_error', handleCaptureError);
    manager.on('camera_disconnected', handleCameraDisconnected);
    manager.on('photo_downloaded', handlePhotoDownloaded);
    manager.on('camera_connecting', handleCameraConnecting);
    manager.on('camera_connect_failed', handleCameraConnectFailed);
    manager.on('camera_connected', handleCameraConnected);
    manager.on('polling_paused', handlePollingPaused);
    manager.on('polling_resumed', handlePollingResumed);

    // Auto-connect on mount - will be in 'NC' state until user clicks connect
    // Note: manager.connect() is NOT called here - user must click connect button

    return () => {
      manager.off('status', handleStatus);
      manager.off('connected', handleConnected);
      manager.off('disconnected', handleDisconnected);
      manager.off('capture_error', handleCaptureError);
      manager.off('camera_disconnected', handleCameraDisconnected);
      manager.off('photo_downloaded', handlePhotoDownloaded);
      manager.off('camera_connecting', handleCameraConnecting);
      manager.off('camera_connect_failed', handleCameraConnectFailed);
      manager.off('camera_connected', handleCameraConnected);
      manager.off('polling_paused', handlePollingPaused);
      manager.off('polling_resumed', handlePollingResumed);
      // Only disconnect WebSocket if we're the main window (not guest-display)
      try {
        const currentWindow = getCurrentWebviewWindow();
        if (currentWindow.label !== 'guest-display') {
          manager.disconnect();
        }
      } catch {
        manager.disconnect();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-clear downloading state after 5 seconds
  useEffect(() => {
    if (isDownloading) {
      if (downloadTimeoutRef.current) {
        clearTimeout(downloadTimeoutRef.current);
      }
      downloadTimeoutRef.current = setTimeout(() => {
        setIsDownloading(false);
      }, 5000);
    }
    return () => {
      if (downloadTimeoutRef.current) {
        clearTimeout(downloadTimeoutRef.current);
        downloadTimeoutRef.current = null;
      }
    };
  }, [isDownloading]);

  // Derive connection state text from current state
  const connectionStateText = getConnectionStateText(connectionState);

  return (
    <CameraContext.Provider value={{
      connectionState,
      connectionStateText,
      isWsConnected,
      isCameraConnected,
      hasEverConnected,
      isConnecting,
      setConnecting: setIsConnecting,
      connect,
      disconnect,
      reconnect,
      batteryLevel,
      shootingMode,
      lastStatus,
      captureError,
      clearCaptureError,
      isDownloading,
      setDownloading: setIsDownloading,
      addStatusListener,
      removeStatusListener,
      addPhotoDownloadedListener,
      removePhotoDownloadedListener,
      setCameraHttpConnected,
      serialNumber,
      firmware,
      isPollingPaused,
      pausePolling,
      resumePolling
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

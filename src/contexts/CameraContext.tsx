import { createContext, useContext, useEffect, useState, useRef, useCallback, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
  // Connection state management
  const [connectionState, setConnectionState] = useState<ConnectionState>('NC');
  const [batteryLevel, setBatteryLevel] = useState<string | null>(null);
  const [shootingMode, setShootingMode] = useState('M');
  const [lastStatus, setLastStatus] = useState<CameraStatus | null>(null);
  const [isCameraConnected, setIsCameraConnected] = useState(false); // Actual camera connection state
  const [hasEverConnected, setHasEverConnected] = useState(false); // Track if camera ever connected this session
  const [isConnecting, setIsConnecting] = useState(false); // Track when camera is being connected
  const [captureError, setCaptureError] = useState<string | null>(null);

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
      //console.log(`[CameraContext] Connection state: ${connectionStateRef.current} -> ${newState}`);
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
      setHasEverConnected(true);
      console.log('[CameraContext] Camera connected via HTTP API, cameraId:', cameraId);
    } else if (!connected) {
      hasHttpConnectedRef.current = false;
      selectedCameraIdRef.current = null;
    }
  }, []);

  // Connect function - initiates connection to the control center
  const connect = useCallback(() => {
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
      console.log('[CameraContext] Re-registering camera after reconnect:', cameraId);
      fetch(`http://localhost:58321/api/controller/switch?camera=${cameraId}`, { method: 'POST' })
        .then(() => console.log('[CameraContext] Camera re-registered successfully'))
        .catch((err) => console.warn('[CameraContext] Failed to re-register camera:', err));
    }
  }, [updateConnectionState]);

  // Disconnect function - user-initiated disconnect
  const disconnect = useCallback(() => {
    connectionStateRef.current = 'NC'; // sync ref immediately
    setConnectionState('NC');
    hasReceivedStatusRef.current = false;
    selectedCameraIdRef.current = null;
    CameraWebSocketManager.getInstance().disconnect();
  }, []);

  useEffect(() => {
    const manager = CameraWebSocketManager.getInstance();

    // USB filters are set up during initialize_app (splash screen) - no need to call again here

    const handleStatus = (data: CameraStatus) => {
      setLastStatus(data);
      hasReceivedStatusRef.current = true;

      // Debug logging
      //console.log('[CameraContext] handleStatus received:', data);
      //console.log('[CameraContext] Current connectionState:', connectionStateRef.current);

      // Detect if a real camera is connected based on status data
      // Check for meaningful values (not defaults like empty strings or generic values)
      // NOTE: "liveview_streaming" or "liveview" mode alone proves camera is connected!
      const hasRealData = Boolean(
        (data.mode === 'liveview_streaming' || data.mode === 'liveview') ||  // Streaming/liveview = camera connected
        (data.shootingmode && data.shootingmode !== '' && data.shootingmode !== 'undefined') ||
        (data.battery && data.battery !== '' && data.battery !== '0') ||
        (data.iso && data.iso !== '') ||
        (data.aperture && data.aperture !== '') ||
        (data.shutter && data.shutter !== '')
      );

      //console.log('[CameraContext] hasRealData:', hasRealData, 'wasCameraConnected:', wasCameraConnectedRef.current);

      // Use hysteresis to avoid false disconnects during capture
      // Require multiple consecutive empty statuses before marking as disconnected
      if (hasRealData) {
        emptyStatusCountRef.current = 0;
        if (!wasCameraConnectedRef.current) {
          //console.log('[CameraContext] Camera connection state changed: false -> true');
          wasCameraConnectedRef.current = true;
          setIsCameraConnected(true);
          setHasEverConnected(true); // Mark that we've had a camera connection this session
        }

        // Transition to Connected whenever we receive real data while in Connecting/Reconnecting
        // (regardless of previous wasCameraConnected state)
        const currentState = connectionStateRef.current;
        if (currentState === 'Connecting' || currentState === 'Reconnecting') {
          updateConnectionState('Connected');
        }
      } else {
        // If we're in Connecting state and receive status (even if no real data yet),
        // consider it connected and transition to Connected
        const currentState = connectionStateRef.current;
        if (currentState === 'Connecting' && !wasCameraConnectedRef.current) {
          console.log('[CameraContext] Connection established in Connecting state (no real data yet)');
          wasCameraConnectedRef.current = true;
          setIsCameraConnected(true);
          setHasEverConnected(true);
          updateConnectionState('Connected');
        }
        emptyStatusCountRef.current++;
        if (wasCameraConnectedRef.current && emptyStatusCountRef.current >= DISCONNECT_THRESHOLD) {
          console.log('[CameraContext] Camera connection state changed: true -> false (after', emptyStatusCountRef.current, 'empty statuses)');
          wasCameraConnectedRef.current = false;
          setIsCameraConnected(false);

          // If we lose camera connection but WS is still connected, go to Reconnecting
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

      // Notify external listeners (e.g. PhotoboothSidebar)
      statusListenersRef.current.forEach(cb => {
        try { cb(data); } catch (e) { console.error('[CameraContext] listener error:', e); }
      });
    };

    const handleConnected = () => {
      console.log('[CameraContext] WebSocket connected');
      isWsConnectedRef.current = true;
      setIsWsConnected(true);
      // Camera re-registration is handled by the reconnect modal, not here
    };

    const handleDisconnected = () => {
      console.log('[CameraContext] WebSocket disconnected');
      isWsConnectedRef.current = false;
      setIsWsConnected(false);
      hasReceivedStatusRef.current = false;

      // Only go to Reconnecting if we were previously connected
      // If user intentionally disconnected (connectionState === 'NC'), stay in NC
      const currentState = connectionStateRef.current;
      if (currentState === 'Connected' || currentState === 'Connecting') {
        updateConnectionState('Reconnecting');
      }
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

      // If we were connected, go to Reconnecting state
      const currentState = connectionStateRef.current;
      if (currentState === 'Connected' || currentState === 'Connecting') {
        updateConnectionState('Reconnecting');
      }
    };

    const handlePhotoDownloaded = (data: PhotoDownloadedEvent) => {
      console.log('[CameraContext::handlePhotoDownloaded] Photo downloaded event received:', data);
      console.log('[CameraContext::handlePhotoDownloaded] Number of listeners:', photoDownloadedListenersRef.current.size);
      // Notify external listeners (e.g. PhotoboothWorkspace)
      photoDownloadedListenersRef.current.forEach(cb => {
        console.log('[CameraContext::handlePhotoDownloaded] Calling listener:', cb.name || 'anonymous');
        try { cb(data); } catch (e) { console.error('[CameraContext] photo_downloaded listener error:', e); }
      });
    };

    manager.on('status', handleStatus);
    manager.on('connected', handleConnected);
    manager.on('disconnected', handleDisconnected);
    manager.on('capture_error', handleCaptureError);
    manager.on('camera_disconnected', handleCameraDisconnected);
    manager.on('photo_downloaded', handlePhotoDownloaded);

    // Auto-connect on mount - will be in 'NC' state until user clicks connect
    // Note: manager.connect() is NOT called here - user must click connect button

    return () => {
      manager.off('status', handleStatus);
      manager.off('connected', handleConnected);
      manager.off('disconnected', handleDisconnected);
      manager.off('capture_error', handleCaptureError);
      manager.off('camera_disconnected', handleCameraDisconnected);
      manager.off('photo_downloaded', handlePhotoDownloaded);
      manager.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      addStatusListener,
      removeStatusListener,
      addPhotoDownloadedListener,
      removePhotoDownloadedListener,
      setCameraHttpConnected
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

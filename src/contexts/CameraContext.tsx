import { createContext, useContext, useEffect, useState, useRef, useCallback, type ReactNode } from 'react';
import CameraWebSocketManager, { type CameraStatus } from '../services/cameraWebSocket';

interface CameraContextType {
  /** Whether the WebSocket is currently connected */
  isWsConnected: boolean;
  /** Battery level string (e.g. "89") */
  batteryLevel: string | null;
  /** Shooting mode (P, A, S, M) */
  shootingMode: string;
  /** Last raw status from WebSocket */
  lastStatus: CameraStatus | null;
  /** Register a callback for raw status updates (for settings sync) */
  addStatusListener: (cb: (status: CameraStatus) => void) => void;
  /** Unregister a status callback */
  removeStatusListener: (cb: (status: CameraStatus) => void) => void;
}

const CameraContext = createContext<CameraContextType | null>(null);

export function CameraProvider({ children }: { children: ReactNode }) {
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [batteryLevel, setBatteryLevel] = useState<string | null>(null);
  const [shootingMode, setShootingMode] = useState('M');
  const [lastStatus, setLastStatus] = useState<CameraStatus | null>(null);

  // External status listeners (for PhotoboothSidebar settings sync)
  const statusListenersRef = useRef<Set<(status: CameraStatus) => void>>(new Set());

  const addStatusListener = useCallback((cb: (status: CameraStatus) => void) => {
    statusListenersRef.current.add(cb);
  }, []);

  const removeStatusListener = useCallback((cb: (status: CameraStatus) => void) => {
    statusListenersRef.current.delete(cb);
  }, []);

  useEffect(() => {
    const manager = CameraWebSocketManager.getInstance();

    const handleStatus = (data: CameraStatus) => {
      setLastStatus(data);

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

    const handleConnected = () => setIsWsConnected(true);
    const handleDisconnected = () => setIsWsConnected(false);

    manager.on('status', handleStatus);
    manager.on('connected', handleConnected);
    manager.on('disconnected', handleDisconnected);
    manager.connect();

    return () => {
      manager.off('status', handleStatus);
      manager.off('connected', handleConnected);
      manager.off('disconnected', handleDisconnected);
      manager.disconnect();
    };
  }, []);

  return (
    <CameraContext.Provider value={{
      isWsConnected,
      batteryLevel,
      shootingMode,
      lastStatus,
      addStatusListener,
      removeStatusListener,
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

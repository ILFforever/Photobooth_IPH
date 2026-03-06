import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { createLogger } from '../utils/logger';

const logger = createLogger('VMContext');

interface VMContextType {
  /** Whether the Linux VM is currently online (daemon responding) */
  isVmOnline: boolean;
  /** Check if VM is online (manually trigger a health check) */
  checkVmStatus: () => Promise<void>;
}

const VMContext = createContext<VMContextType | null>(null);

/** Polling interval for VM health checks (milliseconds) */
const VM_HEALTH_CHECK_INTERVAL = 5000; // Check every 5 seconds
/** Polling interval for USB camera auto-attach (milliseconds) */
const USB_ATTACH_INTERVAL = 1000; // Check every 1 second

export function VMProvider({ children }: { children: ReactNode }) {
  const [isVmOnline, setIsVmOnline] = useState(false);

  const checkVmStatus = useCallback(async () => {
    try {
      const isOnline = await invoke<boolean>('check_vm_online');
      setIsVmOnline(isOnline);
    } catch (error) {
      logger.error('Failed to check VM status:', error);
      setIsVmOnline(false);
    }
  }, []);

  // Periodic health check
  useEffect(() => {
    // Check immediately on mount
    checkVmStatus();

    // Set up polling interval
    const intervalId = setInterval(() => {
      checkVmStatus();
    }, VM_HEALTH_CHECK_INTERVAL);

    return () => clearInterval(intervalId);
  }, [checkVmStatus]);

  // Poll USB camera attach every second, only while VM is online
  useEffect(() => {
    if (!isVmOnline) return;

    const intervalId = setInterval(async () => {
      try {
        await invoke('attach_all_cameras');
      } catch (error) {
        logger.warn('USB auto-attach failed:', error);
      }
    }, USB_ATTACH_INTERVAL);

    return () => clearInterval(intervalId);
  }, [isVmOnline]);

  return (
    <VMContext.Provider value={{ isVmOnline, checkVmStatus }}>
      {children}
    </VMContext.Provider>
  );
}

export function useVM() {
  const context = useContext(VMContext);
  if (!context) {
    throw new Error('useVM must be used within a VMProvider');
  }
  return context;
}

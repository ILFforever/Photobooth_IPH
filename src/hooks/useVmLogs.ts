import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '../contexts/ToastContext';

export interface VmLogEntry {
  timestamp: string;
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
}

export function useVmLogs() {
  const { showToast } = useToast();
  const [showVmLogs, setShowVmLogs] = useState(false);
  const [vmLogs, setVmLogs] = useState<VmLogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [isRestartingVm, setIsRestartingVm] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);

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
  const handleOpenVmLogs = useCallback(() => {
    setShowVmLogs(true);
    fetchVmLogs();
  }, [fetchVmLogs]);

  // Restart VM
  const handleRestartVm = useCallback(() => {
    setShowRestartConfirm(true);
  }, []);

  const confirmRestartVm = useCallback(async () => {
    setShowRestartConfirm(false);
    setIsRestartingVm(true);
    setLogsError(null);

    try {
      const result = await invoke<string>('restart_vm');
      showToast('VM restarted successfully', 'success', 3000, result);

      // Refresh logs after a short delay to show new boot logs
      setTimeout(() => {
        fetchVmLogs();
      }, 2000);
    } catch (error) {
      console.error('Failed to restart VM:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      setLogsError(`Failed to restart VM: ${errorMsg}`);
      showToast('Failed to restart VM', 'error', 5000, errorMsg);
    } finally {
      setIsRestartingVm(false);
    }
  }, [showToast, fetchVmLogs]);

  const cancelRestartVm = useCallback(() => {
    setShowRestartConfirm(false);
  }, []);

  // Auto-refresh logs every 3 seconds when modal is open
  useEffect(() => {
    if (showVmLogs) {
      const interval = setInterval(fetchVmLogs, 3000);
      return () => clearInterval(interval);
    }
  }, [showVmLogs, fetchVmLogs]);

  return {
    showVmLogs,
    setShowVmLogs,
    vmLogs,
    isLoadingLogs,
    logsError,
    isRestartingVm,
    showRestartConfirm,
    handleOpenVmLogs,
    handleRestartVm,
    confirmRestartVm,
    cancelRestartVm,
    fetchVmLogs,
  };
}

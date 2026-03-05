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

  // Parse raw log strings into structured entries
  const parseLogs = useCallback((logs: string[]): VmLogEntry[] => {
    return logs.map((log) => {
      let level: VmLogEntry['level'] = 'info';
      const lower = log.toLowerCase();
      if (lower.includes('error') || lower.includes('failed')) {
        level = 'error';
      } else if (lower.includes('warning') || lower.includes('warn')) {
        level = 'warning';
      } else if (lower.includes('success') || lower.includes('connected')) {
        level = 'success';
      }
      return { timestamp: '', level, message: log };
    });
  }, []);

  // Fetch VM logs from file via Tauri
  // showLoading controls whether the loading spinner is shown (false for background polling)
  const fetchVmLogs = useCallback(async (showLoading = true) => {
    if (showLoading) setIsLoadingLogs(true);
    setLogsError(null);

    try {
      const response = await invoke<{ logs: string[]; lineCount: number }>('get_vm_logs', {
        lines: 1000,
      });

      setVmLogs(parseLogs(response.logs));
    } catch (error) {
      console.error('Failed to fetch VM logs:', error);
      setLogsError(error instanceof Error ? error.message : 'Failed to fetch logs');
      setVmLogs([]);
    } finally {
      if (showLoading) setIsLoadingLogs(false);
    }
  }, [parseLogs]);

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

  // Auto-refresh logs every second when modal is open (silent, no loading spinner)
  useEffect(() => {
    if (showVmLogs) {
      const interval = setInterval(() => fetchVmLogs(false), 1000);
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

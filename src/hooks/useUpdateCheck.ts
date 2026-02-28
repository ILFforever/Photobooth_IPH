import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { VersionStatus } from '../types/updates';

interface UseUpdateCheckOptions {
  autoCheck?: boolean;
}

const DEBUG = true; // Set to false to disable debug logging

export function useUpdateCheck(options: UseUpdateCheckOptions = {}) {
  const { autoCheck = true } = options;

  const [versionStatus, setVersionStatus] = useState<VersionStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateTarget, setUpdateTarget] = useState<'msi' | 'vm' | 'both'>('msi');
  const [hasChecked, setHasChecked] = useState(false);

  const checkForUpdates = useCallback(async () => {
    if (DEBUG) console.log('[UPDATE] Checking for updates...');
    setChecking(true);
    try {
      const status = await invoke<VersionStatus>('check_all_updates');
      if (DEBUG) {
        console.log('[UPDATE] Update check result:', status);
        console.log('[UPDATE] App update available:', status.app.update_available);
        console.log('[UPDATE] VM update available:', status.vm.update_available);
        console.log('[UPDATE] App has_download:', status.app.has_download);
        console.log('[UPDATE] VM has_download:', status.vm.has_download);
      }
      setVersionStatus(status);
      return status;
    } catch (e) {
      console.error('[UPDATE] Update check failed:', e);
      return null;
    } finally {
      setChecking(false);
    }
  }, []);

  // Show update modal for a specific type
  const showUpdateFor = useCallback((type: 'msi' | 'vm') => {
    if (DEBUG) console.log('[UPDATE] Showing update modal for type:', type);
    setUpdateTarget(type);
    setShowUpdateModal(true);
  }, []);

  // Auto-check when main window becomes visible (after splash closes)
  useEffect(() => {
    if (!autoCheck || hasChecked) return;

    if (DEBUG) console.log('[UPDATE] Setting up window visibility listener');

    const doUpdateCheck = async () => {
      if (hasChecked) return;
      if (DEBUG) console.log('[UPDATE] Window visible, checking for updates');
      setHasChecked(true);
      const status = await checkForUpdates();

      if (!status) return;

      // Check if both updates are available
      const hasAppUpdate = status.app.update_available && status.app.has_download;
      const hasVMUpdate = status.vm.update_available && status.vm.has_download;

      if (hasAppUpdate && hasVMUpdate) {
        if (DEBUG) console.log('[UPDATE] Auto-showing update modal for BOTH updates');
        setUpdateTarget('both');
        setShowUpdateModal(true);
      } else if (hasAppUpdate) {
        if (DEBUG) console.log('[UPDATE] Auto-showing update modal for MSI');
        setUpdateTarget('msi');
        setShowUpdateModal(true);
      } else if (hasVMUpdate) {
        if (DEBUG) console.log('[UPDATE] Auto-showing update modal for VM');
        setUpdateTarget('vm');
        setShowUpdateModal(true);
      } else if (DEBUG) {
        console.log('[UPDATE] No auto-update modal shown (app.update_available=',
          status.app.update_available, ', app.has_download=', status.app.has_download,
          ', vm.update_available=', status.vm.update_available, ', vm.has_download=', status.vm.has_download, ')');
      }
    };

    const setupListener = async () => {
      try {
        const appWindow = getCurrentWindow();
        const isVisible = await appWindow.isVisible();

        // If already visible (splash already closed), check now
        if (isVisible) {
          doUpdateCheck();
          return;
        }

        // Wait for window focus event (happens when splash closes and main shows)
        const unlisten = await appWindow.onFocusChanged(({ payload: focused }) => {
          if (focused && !hasChecked) {
            if (DEBUG) console.log('[UPDATE] Window focused, checking for updates');
            doUpdateCheck();
            unlisten();
          }
        });

        return () => {
          if (DEBUG) console.log('[UPDATE] Cleaning up focus listener');
          unlisten();
        };
      } catch (e) {
        console.error('[UPDATE] Failed to set up visibility listener:', e);
      }
    };

    setupListener();
  }, [autoCheck, hasChecked, checkForUpdates]);

  return {
    versionStatus,
    checking,
    showUpdateModal,
    setShowUpdateModal,
    updateTarget,
    setUpdateTarget,
    checkForUpdates,
    showUpdateFor,
  };
}

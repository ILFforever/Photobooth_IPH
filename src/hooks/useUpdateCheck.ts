import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { VersionStatus } from '../types/updates';
import { createLogger } from '../utils/logger';
const logger = createLogger('UpdateCheck');

interface UseUpdateCheckOptions {
  autoCheck?: boolean;
}

export function useUpdateCheck(options: UseUpdateCheckOptions = {}) {
  const { autoCheck = true } = options;

  const [versionStatus, setVersionStatus] = useState<VersionStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateTarget, setUpdateTarget] = useState<'msi' | 'vm' | 'both'>('msi');
  const [hasChecked, setHasChecked] = useState(false);

  const checkForUpdates = useCallback(async () => {
    logger.debug('[UPDATE] Checking for updates...');
    setChecking(true);
    try {
      const status = await invoke<VersionStatus>('check_all_updates');
      {
        logger.debug('[UPDATE] Update check result:', status);
        logger.debug('[UPDATE] App update available:', status.app.update_available);
        logger.debug('[UPDATE] VM update available:', status.vm.update_available);
        logger.debug('[UPDATE] App has_download:', status.app.has_download);
        logger.debug('[UPDATE] VM has_download:', status.vm.has_download);
      }
      setVersionStatus(status);
      return status;
    } catch (e) {
      logger.error('[UPDATE] Update check failed:', e);
      return null;
    } finally {
      setChecking(false);
    }
  }, []);

  // Show update modal for a specific type
  const showUpdateFor = useCallback((type: 'msi' | 'vm') => {
    logger.debug('[UPDATE] Showing update modal for type:', type);
    setUpdateTarget(type);
    setShowUpdateModal(true);
  }, []);

  // Auto-check when main window becomes visible (after splash closes)
  useEffect(() => {
    if (!autoCheck || hasChecked) return;

    logger.debug('[UPDATE] Setting up window visibility listener');

    const doUpdateCheck = async () => {
      if (hasChecked) return;
      logger.debug('[UPDATE] Window visible, checking for updates');
      setHasChecked(true);
      const status = await checkForUpdates();

      if (!status) return;

      // Check if both updates are available
      const hasAppUpdate = status.app.update_available && status.app.has_download;
      const hasVMUpdate = status.vm.update_available && status.vm.has_download;

      if (hasAppUpdate && hasVMUpdate) {
        logger.debug('[UPDATE] Auto-showing update modal for BOTH updates');
        setUpdateTarget('both');
        setShowUpdateModal(true);
      } else if (hasAppUpdate) {
        logger.debug('[UPDATE] Auto-showing update modal for MSI');
        setUpdateTarget('msi');
        setShowUpdateModal(true);
      } else if (hasVMUpdate) {
        logger.debug('[UPDATE] Auto-showing update modal for VM');
        setUpdateTarget('vm');
        setShowUpdateModal(true);
      } else {
        logger.debug('[UPDATE] No auto-update modal shown (app.update_available=',
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
            logger.debug('[UPDATE] Window focused, checking for updates');
            doUpdateCheck();
            unlisten();
          }
        });

        return () => {
          logger.debug('[UPDATE] Cleaning up focus listener');
          unlisten();
        };
      } catch (e) {
        logger.error('[UPDATE] Failed to set up visibility listener:', e);
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

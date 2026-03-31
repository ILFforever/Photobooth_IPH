import { motion, AnimatePresence } from "framer-motion";
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Download, Loader2, AlertCircle, Package, CheckCircle2, Info, Monitor, HardDrive } from 'lucide-react';
import type { UpdateDownloadProgress, VersionStatus } from '../../../types/updates';
import { useToast } from '../../../contexts';
import { createLogger } from '../../../utils/logger';
import './UpdateModal.css';
import "../../../styles/Modal.css";
import "../../../styles/Buttons.css";

const logger = createLogger('UpdateModal');

interface UpdateModalProps {
  show: boolean;
  onClose: () => void;
  updateType: 'msi' | 'vm' | 'both';
  versionStatus: VersionStatus;
}

type DownloadState = 'idle' | 'downloading' | 'verifying' | 'ready' | 'error';

interface UpdateState {
  msi: DownloadState;
  vm: DownloadState;
  msiProgress: UpdateDownloadProgress;
  vmProgress: UpdateDownloadProgress;
  msiError: string | null;
  vmError: string | null;
  msiPath: string | null;
}

export default function UpdateModal({
  show,
  onClose,
  updateType,
  versionStatus,
}: UpdateModalProps) {
  const { showToast } = useToast();
  const [updateState, setUpdateState] = useState<UpdateState>({
    msi: 'idle',
    vm: 'idle',
    msiProgress: { downloaded: 0, total: 0, percent: 0 },
    vmProgress: { downloaded: 0, total: 0, percent: 0 },
    msiError: null,
    vmError: null,
    msiPath: null,
  });

  // Reset state when modal closes
  useEffect(() => {
    if (!show) {
      setUpdateState({
        msi: 'idle',
        vm: 'idle',
        msiProgress: { downloaded: 0, total: 0, percent: 0 },
        vmProgress: { downloaded: 0, total: 0, percent: 0 },
        msiError: null,
        vmError: null,
        msiPath: null,
      });
    }
  }, [show]);

  // Listen for download progress
  useEffect(() => {
    if (!show) return;

    logger.debug('[UPDATE MODAL] Setting up progress listener');

    const unlisten = listen<UpdateDownloadProgress>('update-download-progress', (event) => {
      logger.debug('[UPDATE MODAL] Progress update:', event.payload);
      const progress = event.payload;
      // Determine which update this is for based on file size
      const msiSize = versionStatus.app.file_size || 0;
      const vmSize = versionStatus.vm.file_size || 0;

      if (msiSize > 0 && Math.abs(progress.total - msiSize) < 1000) {
        setUpdateState(prev => ({ ...prev, msiProgress: progress }));
      } else if (vmSize > 0 && Math.abs(progress.total - vmSize) < 1000) {
        setUpdateState(prev => ({ ...prev, vmProgress: progress }));
      }
    });

    return () => {
      logger.debug('[UPDATE MODAL] Cleaning up progress listener');
      unlisten.then(fn => fn());
    };
  }, [show, versionStatus]);

  // Format bytes to human readable size
  const formatBytes = (bytes: number | null): string => {
    if (!bytes) return 'Unknown size';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Handle MSI download
  const handleMsiUpdate = useCallback(async () => {
    logger.debug('[UPDATE MODAL] Starting MSI download...');
    setUpdateState(prev => ({ ...prev, msi: 'downloading', msiError: null }));

    try {
      const path = await invoke<string>('download_msi_update');
      logger.debug('[UPDATE MODAL] MSI Download complete, path:', path);
      setUpdateState(prev => ({ ...prev, msi: 'ready', msiPath: path }));
    } catch (e) {
      logger.error('[UPDATE MODAL] MSI Download failed:', e);
      setUpdateState(prev => ({ ...prev, msi: 'error', msiError: String(e) }));
    }
  }, []);

  // Handle VM download
  const handleVmUpdate = useCallback(async () => {
    logger.debug('[UPDATE MODAL] Starting VM download...');
    setUpdateState(prev => ({ ...prev, vm: 'downloading', vmError: null }));

    try {
      const url = `https://photobooth-iph.fly.dev/api/releases/download?type=vm`;
      await invoke<string>('install_vm_update', { url, version: versionStatus.vm.latest_version || '' });
      logger.debug('[UPDATE MODAL] VM download complete');
      setUpdateState(prev => ({ ...prev, vm: 'ready' }));
    } catch (e) {
      logger.error('[UPDATE MODAL] VM download failed:', e);
      setUpdateState(prev => ({ ...prev, vm: 'error', vmError: String(e) }));
    }
  }, [versionStatus.vm.latest_version]);

  // Handle MSI install
  const handleMsiInstall = useCallback(async () => {
    if (!updateState.msiPath) return;

    try {
      logger.debug('[UPDATE MODAL] Launching MSI installer:', updateState.msiPath);
      await invoke('launch_msi_installer', { msiPath: updateState.msiPath });
    } catch (e) {
      logger.error('[UPDATE MODAL] Failed to launch installer:', e);
      setUpdateState(prev => ({ ...prev, msiError: String(e) }));
    }
  }, [updateState.msiPath]);

  // Handle VM restart
  const handleVmRestart = useCallback(() => {
    logger.debug('[UPDATE MODAL] Restarting VM...');
    // Close modal and show toast immediately
    if (updateType === 'vm') {
      onClose();
    }
    showToast('VM is restarting...', 'success', 5000);
    // Fire and forget - don't await
    invoke('restart_vm').catch((e) => {
      logger.error('[UPDATE MODAL] Failed to restart VM:', e);
      showToast('Failed to restart VM', 'error', 5000, String(e));
    });
  }, [updateType, onClose, showToast]);

  // Retry download
  const handleRetry = useCallback((type: 'msi' | 'vm') => {
    if (type === 'msi') {
      handleMsiUpdate();
    } else {
      handleVmUpdate();
    }
  }, [handleMsiUpdate, handleVmUpdate]);

  if (!show) return null;

  const isBoth = updateType === 'both';
  const title = isBoth ? 'Updates Available' : (updateType === 'msi' ? 'App Update Available' : 'VM Update Available');

  // Get data based on type
  const appData = versionStatus.app;
  const vmData = versionStatus.vm;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="modal-overlay"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="update-modal-content"
          style={{ maxWidth: isBoth ? '560px' : '440px' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="update-modal-header">
            <div className="update-modal-icon">
              <Package size={40} />
            </div>
            <div className="update-modal-title">
              <h2>{title}</h2>
              <p className="update-modal-subtitle">
                {isBoth
                  ? `${appData.update_available ? 'App' : ''}${appData.update_available && vmData.update_available ? ' & ' : ''}${vmData.update_available ? 'VM' : ''} updates available`
                  : `Version ${updateType === 'msi' ? appData.current_version : vmData.current_version} → ${updateType === 'msi' ? appData.latest_version : vmData.latest_version || ''}`}
              </p>
            </div>
          </div>

          {/* Updates List */}
          <div className="update-modal-updates-list">
            {/* MSI Update Card */}
            {(updateType === 'msi' || isBoth) && (
              <UpdateCard
                type="msi"
                data={appData}
                state={updateState.msi}
                progress={updateState.msiProgress}
                error={updateState.msiError}
                downloadedPath={updateState.msiPath}
                onUpdate={handleMsiUpdate}
                onInstall={handleMsiInstall}
                onRetry={() => handleRetry('msi')}
              />
            )}

            {/* VM Update Card */}
            {updateType === 'vm' && (
              <UpdateCard
                type="vm"
                data={vmData}
                state={updateState.vm}
                progress={updateState.vmProgress}
                error={updateState.vmError}
                downloadedPath={null}
                onUpdate={handleVmUpdate}
                onInstall={handleVmRestart}
                onRetry={() => handleRetry('vm')}
              />
            )}
          </div>

          {/* Close button for 'both' mode */}
          {isBoth && (
            <div className="update-modal-actions">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onClose}
                className="btn-secondary"
              >
                Close
              </motion.button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

interface UpdateCardProps {
  type: 'msi' | 'vm';
  data: {
    current_version: string;
    latest_version: string | null;
    update_available: boolean;
    release_notes: string[];
    file_size: number | null;
  };
  state: DownloadState;
  progress: UpdateDownloadProgress;
  error: string | null;
  downloadedPath: string | null;
  onUpdate: () => void;
  onInstall: () => void | Promise<void>;
  onRetry: () => void;
}

const NOTES_LIMIT = 5;

function UpdateCard({
  type,
  data,
  state,
  progress,
  error,
  downloadedPath: _downloadedPath,
  onUpdate,
  onInstall,
  onRetry,
}: UpdateCardProps) {
  const isMsi = type === 'msi';
  const [notesExpanded, setNotesExpanded] = useState(false);
  const prevStateRef = useRef(state);
  useEffect(() => {
    if (prevStateRef.current !== state) {
      prevStateRef.current = state;
      setNotesExpanded(false);
    }
  }, [state]);
  const icon = isMsi ? <HardDrive size={20} /> : <Monitor size={20} />;
  const name = isMsi ? 'App' : 'VM';

  if (!data.update_available || !data.latest_version) {
    return (
      <div className="update-card update-card-up-to-date">
        {icon}
        <div className="update-card-content">
          <strong>{name} Up to Date</strong>
          <span>Version {data.current_version}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`update-card ${state === 'downloading' ? 'update-card-downloading' : ''} ${state === 'ready' ? 'update-card-ready' : ''} ${state === 'error' ? 'update-card-error' : ''}`}>
      <div className="update-card-header">
        {icon}
        <div className="update-card-title">
          <span>{name} Update</span>
          <span>Version {data.current_version} → {data.latest_version}</span>
        </div>
        {data.file_size && (
          <span className="update-card-size">{(data.file_size / (1024 * 1024)).toFixed(1)} MB</span>
        )}
      </div>

      {/* Idle state - show release notes and download button */}
      {state === 'idle' && (
        <>
          {data.release_notes.length > 0 && (
            <div className="update-card-notes">
              <ul>
                {(notesExpanded ? data.release_notes : data.release_notes.slice(0, NOTES_LIMIT)).map((note, idx) => (
                  <li key={idx}>{note}</li>
                ))}
              </ul>
              {data.release_notes.length > NOTES_LIMIT && (
                <button className="update-notes-toggle" onClick={() => setNotesExpanded(e => !e)}>
                  {notesExpanded ? 'Show less' : `+${data.release_notes.length - NOTES_LIMIT} more`}
                </button>
              )}
            </div>
          )}
          <div className={`update-card-warning ${isMsi ? 'warning-msi' : 'warning-vm'}`}>
            <Info size={12} />
            <span>{isMsi
              ? 'App will close. Save work first.'
              : 'VM will restart. Session will be lost.'}</span>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onUpdate}
            className="btn-primary btn-sm"
          >
            <Download size={14} />
            Update
          </motion.button>
        </>
      )}

      {/* Downloading state */}
      {state === 'downloading' && (
        <>
          <div className="update-card-progress">
            <div className="update-card-progress-header">
              <span>Downloading...</span>
              <span>{progress.percent}%</span>
            </div>
            <div className="update-card-progress-bar">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress.percent}%` }}
                transition={{ ease: 'linear' }}
                className="update-card-progress-fill"
              />
            </div>
          </div>
        </>
      )}

      {/* Ready state */}
      {state === 'ready' && (
        <div className="update-card-ready-state">
          <div className="update-card-ready-info">
            <CheckCircle2 size={16} />
            <span>Downloaded!</span>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onInstall}
            className="update-card-install-btn"
          >
            {isMsi ? 'Install' : 'Restart VM'}
          </motion.button>
        </div>
      )}

      {/* Error state */}
      {state === 'error' && (
        <div className="update-card-error-state">
          <AlertCircle size={16} />
          <span>{error || 'Download failed'}</span>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onRetry}
            className="btn-secondary btn-sm"
          >
            Retry
          </motion.button>
        </div>
      )}
    </div>
  );
}

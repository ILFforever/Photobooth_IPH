import { motion, AnimatePresence } from "framer-motion";
import { open } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useState, useEffect, useRef } from 'react';
import { useToast } from '../../../contexts';
import { RefreshCw, Loader2 } from 'lucide-react';
import './RequirementsModal.css';
import { createLogger } from '../../../utils/logger';

const logger = createLogger('RequirementsModal');

interface RequirementCheck {
  passed: boolean;
  requirements: {
    virtualbox_installed: boolean;
    virtualbox_version: string | null;
    bundled_installer_available: boolean;
    recommendations: string[];
  };
}

interface RequirementsModalProps {
  show: boolean;
  onClose: () => void;
  virtualboxInstalled: boolean;
  virtualboxVersion?: string;
  bundledInstallerAvailable?: boolean;
}

export default function RequirementsModal({
  show,
  onClose,
  virtualboxInstalled,
  virtualboxVersion,
  bundledInstallerAvailable = false,
}: RequirementsModalProps) {
  const [isInstalling, setIsInstalling] = useState(false);
  const [isWaitingForInstall, setIsWaitingForInstall] = useState(false);
  const [installDetected, setInstallDetected] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const { showToast } = useToast();

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  if (!show) return null;

  const downloadVirtualBox = () => {
    open('https://www.virtualbox.org/wiki/Downloads');
  };

  const checkVirtualBoxInstalled = async (): Promise<boolean> => {
    try {
      const result: RequirementCheck = await invoke('get_system_requirements');
      return result.requirements.virtualbox_installed;
    } catch {
      return false;
    }
  };

  const startPollingForVirtualBox = () => {
    setIsWaitingForInstall(true);

    // Poll every 2 seconds for VirtualBox installation
    pollingRef.current = setInterval(async () => {
      const isInstalled = await checkVirtualBoxInstalled();
      if (isInstalled) {
        // Stop polling
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        setIsWaitingForInstall(false);
        setInstallDetected(true);

        // Show success toast
        showToast(
          'VirtualBox installed successfully!',
          'success',
          0,
          'Please restart the app to enable camera features.'
        );
      }
    }, 2000);
  };

  const installBundledVirtualBox = async () => {
    setIsInstalling(true);
    try {
      // Exit fullscreen so the user can interact with the installer / UAC prompt
      const appWindow = getCurrentWindow();
      if (await appWindow.isFullscreen()) {
        await appWindow.setFullscreen(false);
      }
      await invoke('launch_virtualbox_installer');
      // Start polling for VirtualBox installation
      startPollingForVirtualBox();
    } catch (error) {
      logger.error('Failed to launch VirtualBox installer:', error);
      // Fallback to download
      downloadVirtualBox();
    }
    setIsInstalling(false);
  };

  const handleRestart = async () => {
    await invoke('restart_app');
  };

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
          className="modal-content requirements-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '0.75rem' }}>
              {installDetected ? '✅' : isWaitingForInstall ? <Loader2 size={48} className="spin" /> : virtualboxInstalled ? '✅' : '⚠️'}
            </div>
            <h2 style={{ marginBottom: '0.5rem' }}>
              {installDetected ? 'Installation Complete!' : isWaitingForInstall ? 'Installing VirtualBox...' : virtualboxInstalled ? 'System Requirements Met' : 'System Requirements'}
            </h2>
          </div>

          <div style={{ marginBottom: '1.5rem', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
            {installDetected ? (
              <div style={{ background: 'rgba(46, 160, 67, 0.1)', padding: '1rem', borderRadius: '8px', textAlign: 'center', border: '1px solid rgba(46, 160, 67, 0.3)' }}>
                <p style={{ marginBottom: '0.5rem', fontSize: '14px', color: 'var(--text-primary)' }}>
                  <strong>VirtualBox has been installed!</strong>
                </p>
                <p style={{ fontSize: '13px', marginBottom: '1rem' }}>
                  Please restart Photobooth_IPH to enable camera features.
                </p>
              </div>
            ) : isWaitingForInstall ? (
              <div style={{ background: 'var(--bg-primary)', padding: '1rem', borderRadius: '8px', textAlign: 'center' }}>
                <p style={{ fontSize: '13px', marginBottom: '0.5rem' }}>
                  <strong>Waiting for VirtualBox installation to complete...</strong>
                </p>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  This window will update automatically when installation is done.
                </p>
              </div>
            ) : virtualboxInstalled ? (
              <div style={{ background: 'var(--bg-primary)', padding: '1rem', borderRadius: '8px', textAlign: 'center' }}>
                <p style={{ marginBottom: '0.5rem', fontSize: '14px', color: 'var(--text-primary)' }}>
                  <strong>VirtualBox {virtualboxVersion || ''} is installed</strong>
                </p>
                <p style={{ fontSize: '13px' }}>
                  Your system meets all requirements to run Photobooth_IPH.
                </p>
              </div>
            ) : (
              <>
                <div style={{ background: 'var(--bg-primary)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
                  <p style={{ marginBottom: '0.75rem', fontSize: '13px', color: 'var(--text-primary)' }}>
                    <strong>VirtualBox is required for camera functionality</strong>
                  </p>
                  <p style={{ fontSize: '13px', marginBottom: '0.5rem' }}>
                    Photobooth_IPH uses Oracle VirtualBox for USB camera passthrough. This enables:
                  </p>
                  <ul style={{ fontSize: '12px', paddingLeft: '1.5rem', margin: 0 }}>
                    <li>USB camera connection and control</li>
                    <li>Live view streaming (gphoto2 2.5.33+)</li>
                    <li>Camera settings control (ISO, Aperture, Shutter, WB)</li>
                  </ul>
                </div>

                {bundledInstallerAvailable ? (
                  <div style={{ background: 'rgba(46, 160, 67, 0.1)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', border: '1px solid rgba(46, 160, 67, 0.3)' }}>
                    <p style={{ marginBottom: '0.5rem', fontSize: '13px', color: 'var(--text-primary)' }}>
                      <strong>✓ Bundled installer available</strong>
                    </p>
                    <p style={{ fontSize: '12px', margin: 0 }}>
                      VirtualBox installer is included with Photobooth_IPH. Click "Install Now" to install it automatically.
                    </p>
                  </div>
                ) : (
                  <div style={{ background: 'var(--bg-primary)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
                    <p style={{ marginBottom: '0.5rem', fontSize: '13px', color: 'var(--text-primary)' }}>
                      <strong>To install VirtualBox:</strong>
                    </p>
                    <ol style={{ fontSize: '12px', paddingLeft: '1.25rem', margin: 0 }}>
                      <li>Download from the official VirtualBox website</li>
                      <li>Run the installer with administrator privileges</li>
                      <li>Restart Photobooth_IPH after installation</li>
                    </ol>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="buttons-container">
            {installDetected ? (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleRestart}
                className="btn-primary"
              >
                Restart Now
              </motion.button>
            ) : isWaitingForInstall ? (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  if (pollingRef.current) {
                    clearInterval(pollingRef.current);
                    pollingRef.current = null;
                  }
                  setIsWaitingForInstall(false);
                }}
                className="btn-secondary"
              >
                Cancel
              </motion.button>
            ) : !virtualboxInstalled && (
              <>
                {bundledInstallerAvailable ? (
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={installBundledVirtualBox}
                    disabled={isInstalling}
                    className="btn-primary"
                  >
                    {isInstalling ? 'Launching installer...' : 'Install Now'}
                  </motion.button>
                ) : (
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={downloadVirtualBox}
                    className="btn-primary"
                  >
                    Download VirtualBox
                  </motion.button>
                )}
              </>
            )}
            {!installDetected && !isWaitingForInstall && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onClose}
                className={`btn-secondary${virtualboxInstalled || !bundledInstallerAvailable ? '' : ' btn-hidden'}`}
              >
                {virtualboxInstalled ? 'Continue' : 'Skip for Now'}
              </motion.button>
            )}
          </div>

          {!installDetected && !isWaitingForInstall && !virtualboxInstalled && !bundledInstallerAvailable && (
            <p style={{ marginTop: '1rem', fontSize: '11px', color: 'var(--text-secondary)', textAlign: 'center' }}>
              Download VirtualBox from the official website and install it manually.
            </p>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

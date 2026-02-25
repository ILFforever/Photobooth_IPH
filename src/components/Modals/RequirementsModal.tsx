import { motion, AnimatePresence } from "framer-motion";
import { open } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';

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

  if (!show) return null;

  const downloadVirtualBox = () => {
    open('https://www.virtualbox.org/wiki/Downloads');
  };

  const installBundledVirtualBox = async () => {
    setIsInstalling(true);
    try {
      await invoke('launch_virtualbox_installer');
      // Close modal after launching installer
      onClose();
    } catch (error) {
      console.error('Failed to launch VirtualBox installer:', error);
      // Fallback to download
      downloadVirtualBox();
    }
    setIsInstalling(false);
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
          className="modal-content"
          style={{ maxWidth: '500px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '0.75rem' }}>
              {virtualboxInstalled ? '✅' : '⚠️'}
            </div>
            <h2 style={{ marginBottom: '0.5rem' }}>
              {virtualboxInstalled ? 'System Requirements Met' : 'System Requirements'}
            </h2>
          </div>

          <div style={{ marginBottom: '1.5rem', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
            {virtualboxInstalled ? (
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

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {!virtualboxInstalled && (
              <>
                {bundledInstallerAvailable ? (
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={installBundledVirtualBox}
                    disabled={isInstalling}
                    className="btn-primary"
                    style={{ flex: 1 }}
                  >
                    {isInstalling ? 'Installing...' : 'Install Now'}
                  </motion.button>
                ) : (
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={downloadVirtualBox}
                    className="btn-primary"
                    style={{ flex: 1 }}
                  >
                    Download VirtualBox
                  </motion.button>
                )}
              </>
            )}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onClose}
              className="btn-secondary"
              style={{ flex: virtualboxInstalled ? 1 : bundledInstallerAvailable && !virtualboxInstalled ? 0 : 1 }}
            >
              {virtualboxInstalled ? 'Continue' : 'Skip for Now'}
            </motion.button>
          </div>

          {!virtualboxInstalled && !bundledInstallerAvailable && (
            <p style={{ marginTop: '1rem', fontSize: '11px', color: 'var(--text-secondary)', textAlign: 'center' }}>
              Download VirtualBox from the official website and install it manually.
            </p>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

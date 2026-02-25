import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface AboutModalProps {
  show: boolean;
  onClose: () => void;
}

type AboutTab = 'features' | 'modes' | 'tech' | 'versions' | 'contact';

interface AppVersionStatus {
  current_version: string;
  latest_version: string | null;
  update_available: boolean;
}

interface VMVersionStatus {
  current_version: string;
  latest_version: string | null;
  update_available: boolean;
  iso_exists: boolean;
  iso_modified_date: string | null;
}

interface VersionStatus {
  app: AppVersionStatus;
  vm: VMVersionStatus;
}

interface VersionInfo {
  versionStatus: VersionStatus | null;
  virtualboxVersion: string | null;
}

interface AppInfo {
  version: string;
  name: string;
  short_name: string;
  company: string;
}

export default function AboutModal({ show, onClose }: AboutModalProps) {
  const [aboutTab, setAboutTab] = useState<AboutTab>('features');
  const [versions, setVersions] = useState<VersionInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    if (show && !appInfo) {
      fetchAppInfo();
    }
    if (show && aboutTab === 'versions' && !versions) {
      fetchVersions();
    }
  }, [show, aboutTab]);

  const fetchAppInfo = async () => {
    try {
      const info = await invoke<AppInfo>('get_app_info');
      setAppInfo(info);
    } catch (e) {
      console.error('Failed to fetch app info:', e);
    }
  };

  const fetchVersions = async () => {
    try {
      const [versionStatus, requirements] = await Promise.all([
        invoke<VersionStatus>('get_version_status'),
        invoke<{ passed: boolean; requirements: { virtualbox_version: string | null } }>('get_system_requirements')
      ]);
      setVersions({
        versionStatus,
        virtualboxVersion: requirements.requirements.virtualbox_version
      });
    } catch (e) {
      console.error('Failed to fetch versions:', e);
      setVersions({
        versionStatus: {
          app: {
            current_version: 'unknown',
            latest_version: null,
            update_available: false
          },
          vm: {
            current_version: 'unknown',
            latest_version: null,
            update_available: false,
            iso_exists: false,
            iso_modified_date: null
          }
        },
        virtualboxVersion: null
      });
    }
  };

  const checkForUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const appUpdateUrl = "https://intaniaproductionhouse.com/app-version.json";
      const vmUpdateUrl = "https://intaniaproductionhouse.com/vm-version.json";
      const updatedStatus = await invoke<VersionStatus>('check_all_updates', {
        appUrl: appUpdateUrl,
        vmUrl: vmUpdateUrl
      });
      setVersions(prev => prev ? { ...prev, versionStatus: updatedStatus } : null);
    } catch (e) {
      console.error('Failed to check for updates:', e);
    } finally {
      setCheckingUpdate(false);
    }
  };

  if (!show) return null;

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
          style={{ maxWidth: '550px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '0.75rem' }}>📸</div>
            <h2 style={{ marginBottom: '0.25rem' }}>{appInfo?.name || 'Photobooth IPH'}</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '0.25rem', fontSize: '13px' }}>Version {appInfo?.version || '1.0.11'}</p>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '12px' }}>Professional-grade photobooth application for event photography</p>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '0.25rem', fontSize: '12px' }}>Developed by ILFforever for {appInfo?.company || 'Intania Production House'}</p>
          </div>

          <div style={{ marginBottom: '1rem', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
            <div style={{ background: 'var(--bg-primary)', padding: '0.5rem', borderRadius: '8px', marginTop: '0.5rem' }}>
              <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-color)', marginBottom: '0.5rem', position: 'relative', paddingBottom: '0.25rem', overflowX: 'auto' }}>
                {(['features', 'modes', 'tech', 'versions', 'contact'] as AboutTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setAboutTab(tab)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '0.25rem 0.5rem',
                      fontSize: '12px',
                      fontWeight: '600',
                      color: aboutTab === tab ? 'var(--accent-blue)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      position: 'relative',
                      transition: 'color 0.2s ease',
                      whiteSpace: 'nowrap',
                      textTransform: 'capitalize',
                    }}
                  >
                    {tab}
                    {aboutTab === tab && (
                      <motion.div
                        layoutId="aboutUnderline"
                        style={{
                          position: 'absolute',
                          bottom: '-1px',
                          left: 0,
                          right: 0,
                          height: '2px',
                          background: 'var(--accent-blue)',
                          zIndex: 1
                        }}
                      />
                    )}
                  </button>
                ))}
              </div>

              <AnimatePresence mode="wait">
                {aboutTab === 'features' ? (
                  <motion.div
                    key="features"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    style={{ fontSize: '12px' }}
                  >
                    <div style={{ marginBottom: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>Camera Control</div>
                    <ul style={{ paddingLeft: '1.25rem', margin: '0 0 1rem 0' }}>
                      <li>USB camera support via gphoto2 (2.5.33+)</li>
                      <li>HDMI capture device support</li>
                      <li>Real-time live view streaming (MJPEG)</li>
                      <li>Full camera settings (ISO, Aperture, Shutter, White Balance, Metering)</li>
                    </ul>

                    <div style={{ marginBottom: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>Session Management</div>
                    <ul style={{ paddingLeft: '1.25rem', margin: '0 0 1rem 0' }}>
                      <li>Custom photo sets (1x1, 2x2, 3x3, 4x4 grids)</li>
                      <li>Collage workspace with frame templates</li>
                      <li>Background customization</li>
                      <li>Photo editing and finalize view</li>
                    </ul>

                    <div style={{ marginBottom: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>Sharing & Printing</div>
                    <ul style={{ paddingLeft: '1.25rem', margin: 0 }}>
                      <li>Google Drive OAuth2 integration</li>
                      <li>QR code generation with Drive links</li>
                      <li>Windows print dialog integration</li>
                      <li>Multi-screen guest display support</li>
                    </ul>
                  </motion.div>
                ) : aboutTab === 'modes' ? (
                  <motion.div
                    key="modes"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
                        <span style={{ fontSize: '18px' }}>📷</span>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>Photobooth Mode</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>Live camera preview, photo capture, countdown timer, and session management. Auto-places photos into customizable strip layouts.</div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
                        <span style={{ fontSize: '18px' }}>🎨</span>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>Collage Creator</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>Manual drag & drop collage creation with custom frame templates (2x2, 3x3, 4x4). Add backgrounds and fine-tune photo positioning.</div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
                        <span style={{ fontSize: '18px' }}>📱</span>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>QR Generator</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>Upload photos to Google Drive and generate shareable QR codes. Supports individual photos, all photos, or collage-specific QR codes.</div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
                        <span style={{ fontSize: '18px' }}>🖥️</span>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>Guest Display</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>Secondary screen output showing countdown, flash effects, photo display, gallery view, and QR codes for guests to scan.</div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ) : aboutTab === 'tech' ? (
                  <motion.div
                    key="tech"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    style={{ fontSize: '12px' }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      <div>
                        <div style={{ marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>Frontend</div>
                        <ul style={{ paddingLeft: '1rem', margin: 0, color: 'var(--text-secondary)' }}>
                          <li>React 18</li>
                          <li>TypeScript 5</li>
                          <li>Tailwind CSS</li>
                          <li>Framer Motion</li>
                          <li>Material Design Icons</li>
                        </ul>
                      </div>
                      <div>
                        <div style={{ marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>Backend</div>
                        <ul style={{ paddingLeft: '1rem', margin: 0, color: 'var(--text-secondary)' }}>
                          <li>Rust + Tauri 1.x</li>
                          <li>Tokio async runtime</li>
                          <li>gphoto2 2.5.33+</li>
                          <li>Camera Daemon (C)</li>
                          <li>VirtualBox VM</li>
                        </ul>
                      </div>
                    </div>
                    <div style={{ marginTop: '0.75rem', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                      <strong>Architecture:</strong> Hybrid desktop app with React frontend, Rust backend (Tauri IPC), and standalone camera daemon communicating via HTTP API and WebSocket.
                    </div>
                  </motion.div>
                ) : aboutTab === 'versions' ? (
                  <motion.div
                    key="versions"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    style={{ fontSize: '12px' }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {/* App Version */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                        <span style={{ fontSize: '24px' }}>📦</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '2px' }}>Photobooth_IPH App</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)' }}>
                              {versions?.versionStatus?.app.current_version || 'Loading...'}
                            </div>
                            {versions?.versionStatus?.app.update_available && (
                              <span style={{
                                padding: '0.25rem 0.5rem',
                                fontSize: '10px',
                                background: '#22c55e',
                                color: 'white',
                                borderRadius: '4px',
                                fontWeight: '600'
                              }}>
                                UPDATE
                              </span>
                            )}
                          </div>
                          {versions?.versionStatus?.app.latest_version && (
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                              Latest: {versions.versionStatus.app.latest_version}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* VM Version */}
                      <div style={{ padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                          <span style={{ fontSize: '24px' }}>🐧</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '2px' }}>Photobooth VM (photobooth.iso)</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <div style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)' }}>
                                {versions?.versionStatus?.vm.current_version || 'Loading...'}
                              </div>
                              {versions?.versionStatus?.vm.update_available && (
                                <span style={{
                                  padding: '0.25rem 0.5rem',
                                  fontSize: '10px',
                                  background: '#22c55e',
                                  color: 'white',
                                  borderRadius: '4px',
                                  fontWeight: '600'
                                }}>
                                  UPDATE
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', fontSize: '11px', color: 'var(--text-secondary)', paddingLeft: '2.25rem' }}>
                          <div>
                            ISO File: <span style={{ color: versions?.versionStatus?.vm.iso_exists ? '#22c55e' : '#ef4444' }}>
                              {versions?.versionStatus?.vm.iso_exists ? 'Present' : 'Missing'}
                            </span>
                          </div>
                          {versions?.versionStatus?.vm.iso_modified_date && (
                            <div>
                              Modified: <span>{versions.versionStatus.vm.iso_modified_date}</span>
                            </div>
                          )}
                        </div>
                        {versions?.versionStatus?.vm.latest_version && (
                          <div style={{ marginTop: '0.5rem', fontSize: '11px', color: 'var(--text-secondary)', paddingLeft: '2.25rem' }}>
                            Latest available: <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>{versions.versionStatus.vm.latest_version}</span>
                          </div>
                        )}
                      </div>

                      {/* VirtualBox Version */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                        <span style={{ fontSize: '24px' }}>🖥️</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '2px' }}>VirtualBox</div>
                          <div style={{ fontSize: '16px', fontWeight: '600', color: versions?.virtualboxVersion ? 'var(--text-primary)' : '#ef4444' }}>
                            {versions?.virtualboxVersion || 'Not detected'}
                          </div>
                        </div>
                        {!versions?.virtualboxVersion && (
                          <button
                            onClick={() => {
                              window.location.reload();
                            }}
                            style={{
                              padding: '0.4rem 0.75rem',
                              fontSize: '11px',
                              background: 'var(--accent-blue)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontWeight: '500'
                            }}
                          >
                            Retry
                          </button>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={fetchVersions}
                          style={{
                            flex: 1,
                            padding: '0.5rem',
                            fontSize: '12px',
                            background: 'var(--bg-tertiary)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: '500',
                            transition: 'background 0.2s ease'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                        >
                          Refresh Status
                        </button>
                        <button
                          onClick={checkForUpdates}
                          disabled={checkingUpdate}
                          style={{
                            flex: 1,
                            padding: '0.5rem',
                            fontSize: '12px',
                            background: checkingUpdate ? 'var(--bg-tertiary)' : 'var(--accent-blue)',
                            color: checkingUpdate ? 'var(--text-secondary)' : 'white',
                            border: checkingUpdate ? '1px solid var(--border-color)' : '1px solid var(--accent-blue)',
                            borderRadius: '6px',
                            cursor: checkingUpdate ? 'not-allowed' : 'pointer',
                            fontWeight: '500',
                            transition: 'background 0.2s ease'
                          }}
                        >
                          {checkingUpdate ? 'Checking...' : 'Check for Updates'}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="contact"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <a
                        href="https://github.com/ILFforever"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          color: 'var(--text-primary)',
                          textDecoration: 'none',
                          padding: '0.5rem',
                          borderRadius: '6px',
                          background: 'var(--bg-secondary)',
                          transition: 'background 0.2s ease'
                        }}
                      >
                        <span style={{ fontSize: '16px' }}>🐙</span>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: '600' }}>GitHub</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>@ILFforever</div>
                        </div>
                      </a>
                      <a
                        href="mailto:intania.productions@gmail.com"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          color: 'var(--text-primary)',
                          textDecoration: 'none',
                          padding: '0.5rem',
                          borderRadius: '6px',
                          background: 'var(--bg-secondary)',
                          transition: 'background 0.2s ease'
                        }}
                      >
                        <span style={{ fontSize: '16px' }}>📧</span>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: '600' }}>Email</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>intania.productions@gmail.com</div>
                        </div>
                      </a>
                      <div style={{ marginTop: '0.5rem', padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: '6px', textAlign: 'center', fontSize: '11px', color: 'var(--text-secondary)' }}>
                        <div style={{ marginBottom: '0.25rem' }}>© 2025 Intania Production House</div>
                        <div>All rights reserved</div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClose}
            className="btn-primary"
            style={{ width: '100%' }}
          >
            Close
          </motion.button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

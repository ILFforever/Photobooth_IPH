import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { Download, Loader2 } from "lucide-react";
import type { VersionStatus } from "../../types/updates";

interface AboutModalProps {
  show: boolean;
  onClose: () => void;
  versionStatus?: VersionStatus | null;
  onCheckUpdates?: () => void;
  onShowUpdate?: (type: 'msi' | 'vm') => void;
}

type AboutTab = 'features' | 'modes' | 'tech' | 'versions' | 'contact';

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

export default function AboutModal({
  show,
  onClose,
  versionStatus: externalVersionStatus,
  onCheckUpdates: externalCheckUpdates,
  onShowUpdate
}: AboutModalProps) {
  const [aboutTab, setAboutTab] = useState<AboutTab>('features');
  const [versions, setVersions] = useState<VersionInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    if (show && !appInfo) {
      fetchAppInfo();
    }
    if (show && aboutTab === 'versions' && !versions) {
      checkForUpdates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, aboutTab]);

  const fetchAppInfo = async () => {
    try {
      const info = await invoke<AppInfo>('get_app_info');
      setAppInfo(info);
    } catch (e) {
      console.error('Failed to fetch app info:', e);
    }
  };

  const checkForUpdates = async () => {
    setCheckingUpdate(true);
    try {
      // Use external check function if provided, otherwise call directly
      if (externalCheckUpdates) {
        await externalCheckUpdates();
      }

      // Always refresh version status (both local and server check)
      const [versionStatus, requirements] = await Promise.all([
        invoke<VersionStatus>('check_all_updates'),
        invoke<{ passed: boolean; requirements: { virtualbox_version: string | null } }>('get_system_requirements')
      ]);
      setVersions({
        versionStatus,
        virtualboxVersion: requirements.requirements.virtualbox_version
      });
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
              <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-color)', marginBottom: '0.5rem', position: 'relative', paddingBottom: '0.25rem' }}>
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
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                        <span style={{ fontSize: '24px' }}>📦</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '2px' }}>Photobooth_IPH App</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)' }}>
                              {(externalVersionStatus || versions?.versionStatus)?.app.current_version || 'Loading...'}
                            </div>
                            {(externalVersionStatus || versions?.versionStatus)?.app.is_dev_build && (
                              <span style={{
                                padding: '0.25rem 0.5rem',
                                fontSize: '10px',
                                background: '#f59e0b',
                                color: 'white',
                                borderRadius: '4px',
                                fontWeight: '600'
                              }}>
                                DEV
                              </span>
                            )}
                            {(externalVersionStatus || versions?.versionStatus)?.app.latest_version && (
                              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                → {(externalVersionStatus || versions?.versionStatus)!.app.latest_version}
                                {(externalVersionStatus || versions?.versionStatus)?.app.file_size && (
                                  <span> • {Math.round(((externalVersionStatus || versions?.versionStatus)!.app.file_size! / (1024 * 1024)) * 10) / 10} MB</span>
                                )}
                              </span>
                            )}
                          </div>
                          {(externalVersionStatus || versions?.versionStatus)?.app.update_available &&
                           (externalVersionStatus || versions?.versionStatus)?.app.has_download && onShowUpdate && (
                            <button
                              onClick={() => onShowUpdate('msi')}
                              style={{
                                marginTop: '0.5rem',
                                padding: '0.4rem 0.75rem',
                                fontSize: '11px',
                                background: '#22c55e',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: '600',
                                width: 'fit-content'
                              }}
                            >
                              <Download size={12} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
                              Update to {(externalVersionStatus || versions?.versionStatus)!.app.latest_version}
                            </button>
                          )}
                          {/* Release notes */}
                          {(externalVersionStatus || versions?.versionStatus)?.app.release_notes &&
                           (externalVersionStatus || versions?.versionStatus)!.app.release_notes.length > 0 && (
                            <div style={{ marginTop: '0.5rem', fontSize: '11px', color: 'var(--text-secondary)' }}>
                              <div style={{ fontWeight: '500', marginBottom: '0.25rem' }}>What's new:</div>
                              <ul style={{ paddingLeft: '1rem', margin: 0 }}>
                                {(externalVersionStatus || versions?.versionStatus)!.app.release_notes.map((note, idx) => (
                                  <li key={idx}>{note}</li>
                                ))}
                              </ul>
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
                                {(externalVersionStatus || versions?.versionStatus)?.vm.current_version || 'Loading...'}
                              </div>
                              {(externalVersionStatus || versions?.versionStatus)?.vm.update_available && (
                                <>
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
                                  {(externalVersionStatus || versions?.versionStatus)?.vm.has_download && onShowUpdate && (
                                    <button
                                      onClick={() => onShowUpdate('vm')}
                                      className="about-update-btn"
                                    >
                                      Update Now
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', fontSize: '11px', color: 'var(--text-secondary)', paddingLeft: '2.25rem' }}>
                          <div>
                            ISO File: <span style={{ color: (externalVersionStatus || versions?.versionStatus)?.vm.iso_exists ? '#22c55e' : '#ef4444' }}>
                              {(externalVersionStatus || versions?.versionStatus)?.vm.iso_exists ? 'Present' : 'Missing'}
                            </span>
                          </div>
                          {(externalVersionStatus || versions?.versionStatus)?.vm.iso_modified_date && (
                            <div>
                              Modified: <span>{(externalVersionStatus || versions?.versionStatus)!.vm.iso_modified_date}</span>
                            </div>
                          )}
                        </div>
                        {(externalVersionStatus || versions?.versionStatus)?.vm.latest_version && (
                          <div style={{ marginTop: '0.5rem', fontSize: '11px', color: 'var(--text-secondary)', paddingLeft: '2.25rem' }}>
                            Latest available: <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>{(externalVersionStatus || versions?.versionStatus)!.vm.latest_version}</span>
                            {(externalVersionStatus || versions?.versionStatus)?.vm.file_size && (
                              <span> • {Math.round(((externalVersionStatus || versions?.versionStatus)!.vm.file_size! / (1024 * 1024)) * 10) / 10} MB</span>
                            )}
                          </div>
                        )}
                        {/* Release notes */}
                        {(externalVersionStatus || versions?.versionStatus)?.vm.release_notes &&
                         (externalVersionStatus || versions?.versionStatus)!.vm.release_notes.length > 0 && (
                          <div style={{ marginTop: '0.5rem', fontSize: '11px', color: 'var(--text-secondary)', paddingLeft: '2.25rem' }}>
                            <div style={{ fontWeight: '500', marginBottom: '0.25rem' }}>What's new:</div>
                            <ul style={{ paddingLeft: '1rem', margin: 0 }}>
                              {(externalVersionStatus || versions?.versionStatus)!.vm.release_notes.map((note, idx) => (
                                <li key={idx}>{note}</li>
                              ))}
                            </ul>
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

                      {/* Action Button */}
                      <button
                        onClick={checkForUpdates}
                        disabled={checkingUpdate}
                        className="btn-primary"
                        style={{ width: '100%' }}
                      >
                        {checkingUpdate ? (
                          <>
                            <Loader2 size={14} className="spin" />
                            Checking...
                          </>
                        ) : (
                          <>
                            <Download size={14} />
                            Check for Updates
                          </>
                        )}
                      </button>
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
                      <div
                        onClick={() => open('https://github.com/ILFforever')}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          color: 'var(--text-primary)',
                          textDecoration: 'none',
                          padding: '0.5rem',
                          borderRadius: '6px',
                          background: 'var(--bg-secondary)',
                          transition: 'background 0.2s ease',
                          cursor: 'pointer'
                        }}
                      >
                        <span style={{ fontSize: '16px' }}>🐙</span>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: '600' }}>GitHub</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>@ILFforever</div>
                        </div>
                      </div>
                      <div
                        onClick={() => open('mailto:hammymukura@gmail.com')}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          color: 'var(--text-primary)',
                          textDecoration: 'none',
                          padding: '0.5rem',
                          borderRadius: '6px',
                          background: 'var(--bg-secondary)',
                          transition: 'background 0.2s ease',
                          cursor: 'pointer'
                        }}
                      >
                        <span style={{ fontSize: '16px' }}>📧</span>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: '600' }}>Email</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>hammymukura@gmail.com</div>
                        </div>
                      </div>
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

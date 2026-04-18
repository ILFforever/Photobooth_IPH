import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { Check, CircleAlert, Download, Loader2, RefreshCw, Trash2 } from "lucide-react";
import iphLogo from "../../../assets/images/IPH.png";
import type { VersionStatus } from "../../../types/updates";
import { FFmpegDownloadModal } from "../troubleshooting";
import { createLogger } from "../../../utils/logger";
import "../../../styles/Modal.css";
import "../../../styles/Buttons.css";
import "./AboutModal.css";
const logger = createLogger('AboutModal');

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
  const [ffmpegVersion, setFfmpegVersion] = useState<string | null>(null);
  const [showFfmpegModal, setShowFfmpegModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [ffmpegSize, setFfmpegSize] = useState<number | null>(null);
  const [currentVersionNotes, setCurrentVersionNotes] = useState<string[]>([]);

  useEffect(() => {
    if (show && !appInfo) {
      fetchAppInfo();
    }
    if (show && aboutTab === 'versions' && !versions) {
      checkForUpdates();
    }
    if (show && aboutTab === 'versions' && ffmpegVersion === null) {
      checkFfmpegVersion();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, aboutTab]);

  useEffect(() => {
    if (!show) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      const tabs = ['features', 'modes', 'tech', 'versions', 'contact'] as AboutTab[];
      const currentIndex = tabs.indexOf(aboutTab);

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const nextIndex = (currentIndex + 1) % tabs.length;
        setAboutTab(tabs[nextIndex]);
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        setAboutTab(tabs[prevIndex]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [show, onClose, aboutTab]);

  const fetchAppInfo = async () => {
    try {
      const info = await invoke<AppInfo>('get_app_info');
      setAppInfo(info);
    } catch (e) {
      logger.error('Failed to fetch app info:', e);
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
      // Fetch release notes for the currently installed version
      try {
        const notes = await invoke<string[]>('get_version_changelog', { version: versionStatus.app.current_version });
        setCurrentVersionNotes(notes);
      } catch { /* ignore */ }
    } catch (e) {
      logger.error('Failed to check for updates:', e);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const checkFfmpegVersion = async () => {
    try {
      const [version, size] = await Promise.all([
        invoke<string>('get_ffmpeg_version'),
        invoke<number>('get_ffmpeg_size')
      ]);
      setFfmpegVersion(version);
      setFfmpegSize(size);
    } catch (e) {
      setFfmpegVersion(null);
      setFfmpegSize(null);
    }
  };

  const handleDeleteFfmpeg = async () => {
    setShowDeleteConfirm(true);
  };

  const confirmDeleteFfmpeg = async () => {
    setIsDeleting(true);
    setShowDeleteConfirm(false);
    try {
      await invoke('delete_ffmpeg_command');
      setFfmpegVersion(null);
      setFfmpegSize(null);
    } catch (e) {
      logger.error('Failed to delete FFmpeg:', e);
    } finally {
      setIsDeleting(false);
    }
};



  if (!show) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="modal-overlay"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
          className="modal-content"
          style={{ maxWidth: '550px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ textAlign: 'center' }}>
            <img src={iphLogo} alt="IPH" style={{ width: '56px', height: '56px', objectFit: 'contain', margin: '0 auto 0.75rem', display: 'block' }} />
            <h2 style={{ marginBottom: '0.25rem' }}>{appInfo?.name || 'Photobooth IPH'}</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '0.25rem', fontSize: '13px' }}>Version {appInfo?.version || '1.0.11'}</p>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '12px' }}>Professional-grade photobooth application for event photography</p>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '0.25rem', fontSize: '12px' }}>Developed by ILFforever for {appInfo?.company || 'Intania Production House'}</p>
          </div>

          <div style={{ marginBottom: '1rem', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
            <div style={{ background: 'var(--bg-primary)', padding: '0.5rem', borderRadius: '8px', marginTop: '0.5rem', overflowY: 'auto', maxHeight: '45vh', scrollbarWidth: 'none' }}>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 10px', background: 'rgba(0,120,212,0.08)', border: '1px solid rgba(0,120,212,0.2)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                        <span style={{ color: 'var(--accent-blue)', flexShrink: 0 }}>💡</span>
                        Press <kbd style={{ padding: '1px 5px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '3px', fontFamily: 'monospace', fontSize: '10px', color: 'var(--text-primary)' }}>F1</kbd> or click the IPH logo in the top-left to open the menu and switch modes.
                      </div>
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
                  >
                    {(() => {
                      const vs = externalVersionStatus || versions?.versionStatus;
                      const appUpdate = vs?.app.update_available && vs?.app.has_download;
                      const vmUpdate = vs?.vm.update_available && vs?.vm.has_download;
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <div className="versions-table">
                            {/* App row */}
                            <div className="versions-row">
                              <div className="versions-row-meta">
                                <span className="versions-row-name">Photobooth IPH</span>
                                <span className="versions-row-sub">Desktop application</span>
                              </div>
                              <div className="versions-row-right">
                                <span className="versions-row-version">{vs?.app.current_version ?? '—'}</span>
                                {vs?.app.is_dev_build && <span className="version-badge version-badge--dev">DEV</span>}
                                {appUpdate
                                  ? <span className="version-badge version-badge--update"><Download size={10} />{vs!.app.latest_version}{vs!.app.file_size ? ` · ${(vs!.app.file_size / (1024*1024)).toFixed(1)} MB` : ''}</span>
                                  : vs && <span className="version-badge version-badge--ok"><Check size={10} />Up to date</span>
                                }
                                {appUpdate && onShowUpdate && (
                                  <button className="versions-action-btn versions-action-btn--update" onClick={() => onShowUpdate('msi')}>
                                    <Download size={10} /> Update
                                  </button>
                                )}
                              </div>
                            </div>
                            {currentVersionNotes.length > 0 && (
                              <div className="versions-release-notes">
                                <div className="versions-release-notes-title">What's new</div>
                                <ul>{currentVersionNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                              </div>
                            )}

                            {/* VM row */}
                            <div className="versions-row">
                              <div className="versions-row-meta">
                                <span className="versions-row-name">Photobooth VM</span>
                                <span className="versions-row-sub">photobooth.iso · {vs?.vm.iso_exists ? <span style={{ color: '#4ade80' }}>Present</span> : <span style={{ color: '#f87171' }}>Missing</span>}{vs?.vm.iso_modified_date ? ` · ${vs.vm.iso_modified_date}` : ''}</span>
                              </div>
                              <div className="versions-row-right">
                                <span className="versions-row-version">{vs?.vm.current_version ?? '—'}</span>
                                {vmUpdate
                                  ? <span className="version-badge version-badge--update"><Download size={10} />{vs!.vm.latest_version}{vs!.vm.file_size ? ` · ${(vs!.vm.file_size / (1024*1024)).toFixed(1)} MB` : ''}</span>
                                  : vs && <span className="version-badge version-badge--ok"><Check size={10} />Up to date</span>
                                }
                                {vmUpdate && onShowUpdate && (
                                  <button className="versions-action-btn versions-action-btn--update" onClick={() => onShowUpdate('vm')}>
                                    <Download size={10} /> Update
                                  </button>
                                )}
                              </div>
                            </div>
                            {vs?.vm.release_notes && vs.vm.release_notes.length > 0 && (
                              <div className="versions-release-notes">
                                <div className="versions-release-notes-title">What's new</div>
                                <ul>{vs.vm.release_notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                              </div>
                            )}

                            {/* VirtualBox row */}
                            <div className="versions-row">
                              <div className="versions-row-meta">
                                <span className="versions-row-name">VirtualBox</span>
                                <span className="versions-row-sub">Required for VM</span>
                              </div>
                              <div className="versions-row-right">
                                <span className="versions-row-version">{versions?.virtualboxVersion ?? '—'}</span>
                                {versions?.virtualboxVersion
                                  ? <span className="version-badge version-badge--ok"><Check size={10} />Detected</span>
                                  : <span className="version-badge version-badge--missing"><CircleAlert size={10} />Not detected</span>
                                }
                                {!versions?.virtualboxVersion && (
                                  <button className="versions-action-btn" onClick={() => window.location.reload()}><RefreshCw size={10} />Retry</button>
                                )}
                              </div>
                            </div>

                            {/* FFmpeg row */}
                            <div className="versions-row">
                              <div className="versions-row-meta">
                                <span className="versions-row-name">FFmpeg</span>
                                <span className="versions-row-sub">HDMI capture &amp; video{ffmpegSize ? ` · ${(ffmpegSize / (1024*1024)).toFixed(1)} MB` : ''}</span>
                                {ffmpegVersion && (
                                  <button className="versions-action-btn versions-action-btn--danger" style={{ marginTop: '6px', width: 'fit-content' }} onClick={handleDeleteFfmpeg} disabled={isDeleting}>
                                    {isDeleting ? <><Loader2 size={10} className="spin" />Removing…</> : <><Trash2 size={10} />Remove</>}
                                  </button>
                                )}
                              </div>
                              <div className="versions-row-right">
                                <span className="versions-row-version">{ffmpegVersion ?? '—'}</span>
                                {ffmpegVersion
                                  ? <span className="version-badge version-badge--ok"><Check size={10} />Installed</span>
                                  : <span className="version-badge version-badge--missing"><CircleAlert size={10} />Not installed</span>
                                }
                                {!ffmpegVersion && (
                                  <button className="versions-action-btn versions-action-btn--install" onClick={() => setShowFfmpegModal(true)}>
                                    <Download size={10} />Install
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>

                          <button className="versions-check-btn" onClick={checkForUpdates} disabled={checkingUpdate}>
                            {checkingUpdate
                              ? <><Loader2 size={12} className="spin" />Checking…</>
                              : <><RefreshCw size={12} />Check for Updates</>
                            }
                          </button>
                        </div>
                      );
                    })()}
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
                        onClick={() => open('https://iph-photobooth.vercel.app/')}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          color: 'var(--text-primary)',
                          padding: '0.5rem 0.5rem 0.5rem 1rem',
                          borderRadius: '6px',
                          background: 'var(--bg-secondary)',
                          transition: 'background 0.2s ease',
                          cursor: 'pointer'
                        }}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
                          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: '600' }}>Website</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>iph-photobooth.vercel.app</div>
                        </div>
                      </div>
                      <div
                        onClick={() => open('https://github.com/ILFforever')}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          color: 'var(--text-primary)',
                          padding: '0.5rem 0.5rem 0.5rem 1rem',
                          borderRadius: '6px',
                          background: 'var(--bg-secondary)',
                          transition: 'background 0.2s ease',
                          cursor: 'pointer'
                        }}
                      >
                        <svg width="20" height="20" viewBox="0 0 98 96" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                          <path fillRule="evenodd" clipRule="evenodd" d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z" fill="currentColor"/>
                        </svg>
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
                          padding: '0.5rem 0.5rem 0.5rem 1rem',
                          borderRadius: '6px',
                          background: 'var(--bg-secondary)',
                          transition: 'background 0.2s ease',
                          cursor: 'pointer'
                        }}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                          <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.908 1.528-1.147C21.69 2.28 24 3.434 24 5.457z" fill="#EA4335"/>
                        </svg>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: '600' }}>Email</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>hammymukura@gmail.com</div>
                        </div>
                      </div>
                      <div style={{ marginTop: '0.5rem', padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: '6px', textAlign: 'center', fontSize: '11px', color: 'var(--text-secondary)' }}>
                        <div style={{ marginBottom: '0.25rem' }}>© 2026 ILFforever</div>
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
        
         {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="modal-overlay"
            onClick={() => setShowDeleteConfirm(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="modal-content"
              style={{ maxWidth: '400px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ marginBottom: '0.5rem' }}>Delete FFmpeg?</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '13px' }}>
                Are you sure you want to delete FFmpeg? You'll need to download it again to use HDMI capture or video generation features.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  style={{
                    padding: '0.5rem 1rem',
                    fontSize: '12px',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteFfmpeg}
                  style={{
                    padding: '0.5rem 1rem',
                    fontSize: '12px',
                    background: '#ef4444',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: '500',
                  }}
                >
                  Delete FFmpeg
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* FFmpeg Download Modal */}
        {showFfmpegModal && (
          <FFmpegDownloadModal
            show={showFfmpegModal}
            onClose={() => setShowFfmpegModal(false)}
            onDownloadComplete={() => {
              setShowFfmpegModal(false);
              checkFfmpegVersion();
            }}
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
}

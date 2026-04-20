import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { Camera, QrCode, ChevronRight, ChevronLeft, Keyboard, HardDrive, Wifi, Monitor, LayoutTemplate, MousePointer2, Layers, Save } from "lucide-react";
import Icon from "@mdi/react";
import { mdiImageMultiple } from "@mdi/js";
import iphLogo from "../../../assets/images/IPH.png";
import "../../../styles/Modal.css";
import "./WelcomeModal.css";
import type { FeaturedItem } from './ChangelogModal';
import { FEATURED_BY_VERSION } from "../../../constants/changelog";

interface WelcomeModalProps {
  onClose: () => void;
}

const TOTAL_STEPS = 5;

export default function WelcomeModal({ onClose }: WelcomeModalProps) {
  const [step, setStep] = useState(0);
  const [currentVersion, setCurrentVersion] = useState('');
  const [releaseNotes, setReleaseNotes] = useState<string[]>([]);
  const [featuredItems, setFeaturedItems] = useState<FeaturedItem[]>([]);

  useEffect(() => {
    const fetchVersionInfo = async () => {
      try {
        const [appInfo, versionStatus] = await Promise.all([
          invoke<{ version: string }>('get_app_info'),
          invoke<any>('check_all_updates')
        ]);

        const installedVersion = appInfo.version;
        setCurrentVersion(installedVersion);

        // Show changelog for latest version if update available, otherwise current version
        const versionToShow = versionStatus?.app?.update_available
          ? versionStatus.app.latest_version
          : installedVersion;

        // Load featured items for the version being shown
        const featured = FEATURED_BY_VERSION[versionToShow] || [];
        setFeaturedItems(featured);

        const notes = await invoke<string[]>('get_version_changelog', { version: versionToShow });
        setReleaseNotes(notes);
      } catch (e) {
        // Fallback to just app info if version check fails
        try {
          const info = await invoke<{ version: string }>('get_app_info');
          setCurrentVersion(info.version);
          const featured = FEATURED_BY_VERSION[info.version] || [];
          setFeaturedItems(featured);
          const notes = await invoke<string[]>('get_version_changelog', { version: info.version });
          setReleaseNotes(notes);
        } catch {
          // Ignore errors
        }
      }
    };

    fetchVersionInfo();
  }, []);

  const handleClose = async () => {
    try {
      await invoke('save_app_setting', { key: 'welcome_shown', value: 'true' });
    } catch {
      // ignore
    }
    onClose();
  };

  const handleNext = () => {
    if (step < TOTAL_STEPS - 1) {
      setStep(s => s + 1);
    } else {
      handleClose();
    }
  };

  const handlePrev = () => {
    if (step > 0) setStep(s => s - 1);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="modal-overlay"
      onClick={handleClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="welcome-modal"
        onClick={(e) => e.stopPropagation()}
      >
          {/* Step content */}
          <div className="welcome-modal-body">
            <AnimatePresence mode="wait">
              {step === 0 && (
                <motion.div
                  key="step-0"
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={{ duration: 0.2 }}
                  className="welcome-step"
                >
                  <div className="welcome-hero">
                    <img src={iphLogo} alt="IPH" className="welcome-logo" />
<h1 className="welcome-title">Welcome to<br />IPH Photobooth</h1>
                    <p className="welcome-subtitle">
                      Everything you need to run a professional photobooth at events —
                      from live camera capture to instant photo sharing.
                    </p>
                  </div>

                  <div className="welcome-highlights">
                    <div className="welcome-highlight-item">
                      <div className="welcome-highlight-icon">
                        <Camera size={18} />
                      </div>
                      <div>
                        <div className="welcome-highlight-label">Live Camera Control</div>
                        <div className="welcome-highlight-desc">USB and HDMI capture with real-time preview</div>
                      </div>
                    </div>
                    <div className="welcome-highlight-item">
                      <div className="welcome-highlight-icon">
                        <Icon path={mdiImageMultiple} size={0.75} />
                      </div>
                      <div>
                        <div className="welcome-highlight-label">Collage Layouts</div>
                        <div className="welcome-highlight-desc">Custom frames, backgrounds, and photo strips</div>
                      </div>
                    </div>
                    <div className="welcome-highlight-item">
                      <div className="welcome-highlight-icon">
                        <QrCode size={18} />
                      </div>
                      <div>
                        <div className="welcome-highlight-label">Instant Sharing</div>
                        <div className="welcome-highlight-desc">Google Drive upload with QR code generation</div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {step === 1 && (
                <motion.div
                  key="step-1"
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={{ duration: 0.2 }}
                  className="welcome-step"
                >
                  <div className="welcome-step-header">
                    <div className="welcome-step-tag">Four Modes</div>
                    <h2 className="welcome-step-title">Everything in one app</h2>
                    <p className="welcome-step-desc">
                      Switch between modes by pressing <kbd>F1</kbd> then <kbd>1-4</kbd>, or by clicking the IPH logo in the top-left corner.
                    </p>
                  </div>

                  <div className="welcome-modes">
                    <div className="welcome-mode-card">
                      <div className="welcome-mode-icon welcome-mode-icon--blue">
                        <Camera size={22} />
                      </div>
                      <div className="welcome-mode-content">
                        <div className="welcome-mode-name">Photobooth</div>
                        <div className="welcome-mode-desc">
                          Live camera preview, countdown timer, and automated photo capture into strip layouts.
                          Supports USB cameras and HDMI capture devices.
                        </div>
                        <div className="welcome-mode-tags">
                          <span>Camera Tether</span>
                          <span>Live View</span>
                          <span>Print Ready</span>
                          <span>QR Code</span>
                          <span>Guest Display</span>
                        </div>
                      </div>
                    </div>

                    <div className="welcome-mode-card">
                      <div className="welcome-mode-icon welcome-mode-icon--purple">
                        <Icon path={mdiImageMultiple} size={0.9} />
                      </div>
                      <div className="welcome-mode-content">
                        <div className="welcome-mode-name">Collage Creator</div>
                        <div className="welcome-mode-desc">
                          Manually design multi-photo layouts with drag-and-drop frames.
                          Add backgrounds and fine-tune photo positioning.
                        </div>
                        <div className="welcome-mode-tags">
                          <span>Custom Frames</span>
                          <span>Backgrounds</span>
                          <span>Overlays</span>
                          <span>Drag & Drop</span>
                        </div>
                      </div>
                    </div>

                    <div className="welcome-mode-card">
                      <div className="welcome-mode-icon welcome-mode-icon--orange">
                        <Monitor size={22} />
                      </div>
                      <div className="welcome-mode-content">
                        <div className="welcome-mode-name">Guest Display</div>
                        <div className="welcome-mode-desc">
                          Design what guests see on the second monitor — position the collage, QR code, and graphics on a canvas.
                        </div>
                        <div className="welcome-mode-tags">
                          <span>Canvas Editor</span>
                          <span>Collage</span>
                          <span>QR Code</span>
                          <span>Layers</span>
                        </div>
                      </div>
                    </div>

                    <div className="welcome-mode-card">
                      <div className="welcome-mode-icon welcome-mode-icon--green">
                        <QrCode size={22} />
                      </div>
                      <div className="welcome-mode-content">
                        <div className="welcome-mode-name">QR Generator</div>
                        <div className="welcome-mode-desc">
                          A separate utility for uploading any photos to Google Drive and generating
                          shareable QR codes. Not part of the photobooth workflow — use it independently
                          after an event to share galleries with guests.
                        </div>
                        <div className="welcome-mode-tags">
                          <span>Google Drive</span>
                          <span>QR Code</span>
                          <span>Instant Share</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {step === 2 && (
                <motion.div
                  key="step-2"
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={{ duration: 0.2 }}
                  className="welcome-step"
                >
                  <div className="welcome-step-header">
                    <div className="welcome-step-tag">Quick Start</div>
                    <h2 className="welcome-step-title">Get up and running</h2>
                    <p className="welcome-step-desc">
                      A few things to set up before your first event.
                    </p>
                  </div>

                  <div className="welcome-checklist">
                    <div className="welcome-checklist-item">
                      <div className="welcome-checklist-icon">
                        <LayoutTemplate size={16} />
                      </div>
                      <div>
                        <div className="welcome-checklist-label">
                          Create a set in Collage Creator first
                        </div>
                        <div className="welcome-checklist-desc">
                          Before using Photobooth mode, switch to <strong>Collage Creator</strong> and design at least one set — this defines the frame layout that Photobooth will capture photos into.
                        </div>
                      </div>
                    </div>

                    <div className="welcome-checklist-item">
                      <div className="welcome-checklist-icon">
                        <HardDrive size={16} />
                      </div>
                      <div>
                        <div className="welcome-checklist-label">Connect your camera</div>
                        <div className="welcome-checklist-desc">
                          Plug in your USB camera or HDMI capture device, then select it in the Photobooth sidebar under Camera.
                        </div>
                      </div>
                    </div>

                    <div className="welcome-checklist-item">
                      <div className="welcome-checklist-icon">
                        <Wifi size={16} />
                      </div>
                      <div>
                        <div className="welcome-checklist-label">Sign in with Google (optional)</div>
                        <div className="welcome-checklist-desc">
                          Required for Google Drive upload and QR code sharing. Click the account icon in the top-right header.
                        </div>
                      </div>
                    </div>

                    <div className="welcome-checklist-item">
                      <div className="welcome-checklist-icon">
                        <Monitor size={16} />
                      </div>
                      <div>
                        <div className="welcome-checklist-label">Set up a guest display</div>
                        <div className="welcome-checklist-desc">
                          Connect a second monitor to show a live countdown, flash effects, and QR codes to your guests.
                        </div>
                      </div>
                    </div>

                    <div className="welcome-checklist-item">
                      <div className="welcome-checklist-icon">
                        <Keyboard size={16} />
                      </div>
                      <div>
                        <div className="welcome-checklist-label">Useful keyboard shortcuts</div>
                        <div className="welcome-checklist-desc">
                          <span className="welcome-kbd-row">
                            <kbd>F1</kbd> App menu &amp; mode switch
                            <kbd>F11</kbd> Toggle fullscreen
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
              {step === 3 && (
                <motion.div
                  key="step-3"
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={{ duration: 0.2 }}
                  className="welcome-step"
                >
                  <div className="welcome-step-header">
                    <div className="welcome-step-tag">Guest Display</div>
                    <h2 className="welcome-step-title">Design the second screen</h2>
                    <p className="welcome-step-desc">
                      Use the <strong>Display Layout Editor</strong> to design exactly what guests see on the second monitor after each capture.
                    </p>
                  </div>

                  <div className="welcome-checklist">
                    <div className="welcome-checklist-item">
                      <div className="welcome-checklist-icon">
                        <Monitor size={16} />
                      </div>
                      <div>
                        <div className="welcome-checklist-label">Open the Display Layout Editor</div>
                        <div className="welcome-checklist-desc">
                          Access it from the app menu (<kbd>F1</kbd>) or the header. Create a new layout and choose an aspect ratio to match your second monitor.
                        </div>
                      </div>
                    </div>

                    <div className="welcome-checklist-item">
                      <div className="welcome-checklist-icon">
                        <MousePointer2 size={16} />
                      </div>
                      <div>
                        <div className="welcome-checklist-label">Add and position elements</div>
                        <div className="welcome-checklist-desc">
                          Place a <strong>Collage</strong> placeholder (shows the captured photo), a <strong>QR Code</strong>, text, images, GIFs, and shapes — then drag and resize them on the canvas.
                        </div>
                      </div>
                    </div>

                    <div className="welcome-checklist-item">
                      <div className="welcome-checklist-icon">
                        <Layers size={16} />
                      </div>
                      <div>
                        <div className="welcome-checklist-label">Adjust layer order</div>
                        <div className="welcome-checklist-desc">
                          The element list on the right controls stacking. Drag rows to reorder; select an element to edit its properties.
                        </div>
                      </div>
                    </div>

                    <div className="welcome-checklist-item">
                      <div className="welcome-checklist-icon">
                        <Save size={16} />
                      </div>
                      <div>
                        <div className="welcome-checklist-label">Save, then activate</div>
                        <div className="welcome-checklist-desc">
                          Save your layout, then go to <strong>Photobooth → Settings → Guest Display</strong> to select it. The layout goes live on the second monitor when the next session finalizes.
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {step === 4 && (
                <motion.div
                  key="step-4"
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={{ duration: 0.2 }}
                  className="welcome-step"
                >
                  <div className="welcome-step-header">
                    <div className="welcome-step-tag">Release {currentVersion}</div>
                    <h2 className="welcome-step-title">What's New</h2>
                    <p className="welcome-step-desc">Here's what changed in this version.</p>
                  </div>

                  {featuredItems.length > 0 && (
                    <div className="welcome-whats-new-list">
                      {featuredItems.map((item, idx) => {
                        const ItemIcon = item.icon;
                        return (
                          <motion.div
                            key={idx}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.05 + idx * 0.07, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                            className="welcome-whats-new-card"
                          >
                            <div className="welcome-whats-new-icon">
                              <ItemIcon size={20} />
                            </div>
                            <div className="welcome-whats-new-body">
                              <span className="welcome-whats-new-label">{item.label}</span>
                              <div className="welcome-whats-new-title">{item.title}</div>
                              <div className="welcome-whats-new-desc">{item.description}</div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}

                  {releaseNotes && releaseNotes.length > 0 && (
                    <ul className="welcome-release-notes">
                      {releaseNotes.map((note, idx) => (
                        <li key={idx} className="welcome-release-note-item">
                          <span className="welcome-release-note-dot" />
                          <span>{note.replace(/^-+\s*/, '')}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="welcome-modal-footer">
            {/* Dots */}
            <div className="welcome-dots">
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                <button
                  key={i}
                  className={`welcome-dot ${i === step ? 'active' : ''}`}
                  onClick={() => setStep(i)}
                  aria-label={`Go to step ${i + 1}`}
                />
              ))}
            </div>

            {/* Controls */}
            <div className="welcome-footer-right">

              <div className="welcome-nav-btns">
                {step > 0 && (
                  <button className="welcome-btn-secondary" onClick={handlePrev}>
                    <ChevronLeft size={14} />
                    Back
                  </button>
                )}
                <button className="welcome-btn-primary" onClick={handleNext}>
                  {step < TOTAL_STEPS - 1 ? (
                    <>Next <ChevronRight size={14} /></>
                  ) : (
                    'Get Started'
                  )}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
  );
}

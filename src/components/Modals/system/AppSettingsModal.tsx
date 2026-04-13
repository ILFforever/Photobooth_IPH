import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { Monitor, X, BookOpen, Sparkles } from "lucide-react";
import { createLogger } from "../../../utils/logger";
import "../../../styles/Modal.css";
import "./AppSettingsModal.css";

const logger = createLogger('AppSettingsModal');

interface AppSettingsModalProps {
  show: boolean;
  onClose: () => void;
  onShowGuide?: () => void;
  onShowChangelog?: () => void;
}

interface AppSettings {
  start_fullscreen: boolean;
}

const DEFAULTS: AppSettings = {
  start_fullscreen: false,
};

type SettingsTab = 'window';

const tabs: { key: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { key: 'window', label: 'Window', icon: <Monitor size={15} /> },
];

async function loadSetting(key: keyof AppSettings): Promise<string | null> {
  try {
    return await invoke<string | null>('get_app_setting', { key });
  } catch {
    return null;
  }
}

async function saveSetting(key: keyof AppSettings, value: string): Promise<void> {
  try {
    await invoke('save_app_setting', { key, value });
  } catch (e) {
    logger.error(`Failed to save setting "${key}":`, e);
  }
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="settings-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="settings-toggle-track" />
    </label>
  );
}

function SettingRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-info">
        <div className="settings-row-label">{label}</div>
        {desc && <div className="settings-row-desc">{desc}</div>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

export default function AppSettingsModal({ show, onClose, onShowGuide, onShowChangelog }: AppSettingsModalProps) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>('window');

  useEffect(() => {
    if (!show) return;
    (async () => {
      const startFullscreen = await loadSetting('start_fullscreen');
      setSettings({ start_fullscreen: startFullscreen === 'true' });
      setLoaded(true);
    })();
  }, [show]);

  const handleToggle = async (key: keyof AppSettings, value: boolean) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    await saveSetting(key, String(value));
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
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          className="settings-modal"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Sidebar */}
          <div className="settings-sidebar">
            <div className="settings-sidebar-title">Settings</div>
            <nav className="settings-nav">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  className={`settings-nav-item ${activeTab === tab.key ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* Content */}
          <div className="settings-content">
            <div className="settings-content-header">
              <h2 className="settings-content-title">
                {tabs.find(t => t.key === activeTab)?.label}
              </h2>
              <button className="settings-close-btn" onClick={onClose}>
                <X size={16} />
              </button>
            </div>

            {loaded && (
              <div className="settings-content-body">
                {activeTab === 'window' && (
                  <div className="settings-group">
                    <div className="settings-group-label">Display</div>
                    <div className="settings-group-rows">
                      <SettingRow
                        label="Start in fullscreen"
                        desc="Automatically launch the app in fullscreen mode"
                      >
                        <Toggle
                          checked={settings.start_fullscreen}
                          onChange={(v) => handleToggle('start_fullscreen', v)}
                        />
                      </SettingRow>
                      <SettingRow
                        label="Welcome guide"
                        desc="Re-open the new user guide at any time"
                      >
                        <button
                          className="settings-action-btn"
                          onClick={() => { onShowGuide?.(); onClose(); }}
                        >
                          <BookOpen size={13} />
                          Show Guide
                        </button>
                      </SettingRow>
                      <SettingRow
                        label="What's New"
                        desc="View the changelog for the current version"
                      >
                        <button
                          className="settings-action-btn"
                          onClick={() => { onShowChangelog?.(); onClose(); }}
                        >
                          <Sparkles size={13} />
                          View Changelog
                        </button>
                      </SettingRow>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

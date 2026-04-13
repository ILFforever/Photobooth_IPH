import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { X, LucideIcon } from "lucide-react";
import iphLogo from "../../../assets/images/IPH.png";
import "../../../styles/Modal.css";
import "./ChangelogModal.css";

export interface FeaturedItem {
  icon: LucideIcon;
  label: string;       // e.g. "New Feature"
  title: string;       // e.g. "Naming Schemes"
  description: string; // one-line description
}

interface ChangelogModalProps {
  featured?: FeaturedItem | FeaturedItem[];
  onClose: () => void;
}

export default function ChangelogModal({
  featured,
  onClose,
}: ChangelogModalProps) {
  const [version, setVersion] = useState('');
  const [releaseNotes, setReleaseNotes] = useState<string[]>([]);

  useEffect(() => {
    invoke<{ version: string }>('get_app_info').then(info => {
      setVersion(info.version);
      invoke<string[]>('get_version_changelog', { version: info.version })
        .then(notes => setReleaseNotes(notes))
        .catch(() => {});
    }).catch(() => {});
  }, []);

  const featuredItems = featured
    ? Array.isArray(featured) ? featured : [featured]
    : [];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="modal-overlay"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="changelog-modal"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="changelog-header">
            <div className="changelog-header-left">
              <div className="changelog-logo-wrap">
                <img src={iphLogo} alt="IPH" className="changelog-logo" />
              </div>
              <div>
                <div className="changelog-title">What's New</div>
                <div className="changelog-version">Version {version}</div>
              </div>
            </div>
            <button className="changelog-close-btn" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>

          {/* Featured heroes — optional, one or many */}
          {featuredItems.length > 0 && (
            <div className="changelog-featured-list">
              {featuredItems.map((item, idx) => {
                const Icon = item.icon;
                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + idx * 0.07, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    className="changelog-featured"
                  >
                    <div className="changelog-featured-icon-wrap">
                      <Icon size={22} />
                    </div>
                    <div className="changelog-featured-body">
                      <span className="changelog-featured-label">{item.label}</span>
                      <div className="changelog-featured-title">{item.title}</div>
                      <div className="changelog-featured-desc">{item.description}</div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Notes list */}
          {releaseNotes.length > 0 && (
            <div className="changelog-body">
              <ul className="changelog-notes">
                {releaseNotes.map((note, idx) => { const text = note.replace(/^-+\s*/, ''); return (
                  <motion.li
                    key={idx}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay: (featuredItems.length > 0 ? 0.1 + featuredItems.length * 0.07 + 0.08 : 0.1) + idx * 0.055,
                      duration: 0.25,
                      ease: "easeOut",
                    }}
                    className="changelog-note-item"
                  >
                    <span className="changelog-note-dot" />
                    <span>{text}</span>
                  </motion.li>
                ); })}
              </ul>
            </div>
          )}

          {/* Empty fallback */}
          {featuredItems.length === 0 && releaseNotes.length === 0 && (
            <div className="changelog-body">
              <div className="changelog-empty">
                <p>App updated to version {version}.</p>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="changelog-footer">
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.28 + releaseNotes.length * 0.055 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="btn-primary changelog-btn"
              onClick={onClose}
            >
              Got it
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

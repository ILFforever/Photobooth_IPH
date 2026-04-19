import { X, Keyboard } from "lucide-react";
import { useEffect } from "react";
import "./KeyboardShortcutsModal.css";

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="shortcuts-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-modal-title"
    >
      <div
        className="shortcuts-modal-content"
        onClick={e => e.stopPropagation()}
        role="document"
        tabIndex={-1}
      >
        <div className="shortcuts-modal-header">
          <div className="header-title">
            <Keyboard size={18} />
            <h2 id="shortcuts-modal-title">Keyboard Shortcuts</h2>
          </div>
          <button
            className="close-btn"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
          >
            <X size={18} />
          </button>
        </div>
        
        <div className="shortcuts-modal-body">
          <div className="shortcut-section">
            <h3>Capture & Session</h3>
            <div className="shortcuts-grid">
              <div className="shortcut-item">
                <span className="key-combo">Space / Enter</span>
                <span className="key-desc">Trigger Camera Capture</span>
              </div>
              <div className="shortcut-item">
                <span className="key-combo">↑ / ↓</span>
                <span className="key-desc">Adjust Auto Interval</span>
              </div>
              <div className="shortcut-item">
                <span className="key-combo">A</span>
                <span className="key-desc">Toggle Auto Mode</span>
              </div>
              <div className="shortcut-item">
                <span className="key-combo">H</span>
                <span className="key-desc">Hold / Pause Auto Sequence</span>
              </div>
            </div>
          </div>

          <div className="shortcut-section">
            <h3>Guest Display Control</h3>
            <div className="shortcuts-grid">
              <div className="shortcut-item">
                <span className="key-combo">Q</span>
                <span className="key-desc">Switch to Single View</span>
              </div>
              <div className="shortcut-item">
                <span className="key-combo">W</span>
                <span className="key-desc">Switch to Center View</span>
              </div>
              <div className="shortcut-item">
                <span className="key-combo">E</span>
                <span className="key-desc">Switch to Canvas View</span>
              </div>
            </div>
          </div>

          <div className="shortcut-section">
            <h3>Canvas Mode</h3>
            <div className="shortcuts-grid">
              <div className="shortcut-item">
                <span className="key-combo">1 - 9</span>
                <span className="key-desc">Select Photo #1 - #9</span>
              </div>
              <div className="shortcut-item">
                <span className="key-combo">0</span>
                <span className="key-desc">Select Photo #10</span>
              </div>
            </div>
          </div>
        </div>

        <div className="shortcuts-modal-footer">
          <button className="done-btn" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}

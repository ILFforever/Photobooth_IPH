import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useCamera } from "../../../contexts";

interface CleanupModalProps {
  show: boolean;
  onCancel: () => void;
}

export default function CleanupModal({ show, onCancel }: CleanupModalProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState("Shutting down VM...");
  const { disconnect } = useCamera();

  // Reset confirmed state when modal is hidden
  useEffect(() => {
    if (!show) setConfirmed(false);
  }, [show]);

  // Handle keyboard shortcuts (Enter=confirm, Esc=cancel)
  useEffect(() => {
    if (!show || confirmed) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        setConfirmed(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [show, confirmed, onCancel]);

  useEffect(() => {
    if (!show || !confirmed) return;

    const cleanup = async () => {
      try {
        setStatus("Disconnecting camera...");
        disconnect();
        // Brief pause to let disconnect complete
        await new Promise(r => setTimeout(r, 500));
      } catch {
        // Ignore disconnect errors
      }

      try {
        setStatus("Shutting down VM...");
        await invoke('shutdown_vm');
        setStatus("VM stopped");
      } catch {
        // VM might not be running or VirtualBox not installed - that's fine
        setStatus("Cleanup complete");
      }

      // Brief pause so user sees the final status
      await new Promise(r => setTimeout(r, 500));

      // Force exit the app
      try {
        await invoke('force_exit_app');
      } catch {
        // Fallback: if force_exit_app fails, try exit_app
        try {
          await invoke('exit_app');
        } catch {
          // Last resort
        }
      }
    };

    cleanup();
  }, [show, confirmed, disconnect]);

  if (!show) return null;

  // Confirmation step
  if (!confirmed) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="modal-overlay"
        onClick={onCancel}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="modal-content"
          style={{
            maxWidth: '360px',
            textAlign: 'center',
            overflow: 'hidden',
            maxHeight: 'none',
            padding: '28px 28px 24px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 style={{ marginBottom: '6px', fontSize: '16px' }}>Quit Photobooth?</h2>
          <p style={{
            color: 'var(--text-secondary)',
            fontSize: '12px',
            marginBottom: '20px',
          }}>
            Are you sure you want to exit?
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onCancel}
              className="btn-secondary"
              style={{ flex: 1 }}
            >
              Cancel
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setConfirmed(true)}
              className="btn-danger"
              style={{ flex: 1 }}
            >
              Quit
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  // Cleanup in progress
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="modal-overlay"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="modal-content"
        style={{
          maxWidth: '420px',
          textAlign: 'center',
          overflow: 'hidden',
          maxHeight: 'none',
          padding: '32px 32px 28px',
        }}
      >
        <h2 style={{ marginBottom: '6px', fontSize: '16px' }}>Cleaning up...</h2>
        <p style={{
          color: 'var(--text-secondary)',
          fontSize: '12px',
          marginBottom: '20px',
        }}>
          {status}
        </p>
        <div style={{
          width: '100%',
          height: '2px',
          background: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '1px',
          overflow: 'hidden',
          position: 'relative',
        }}>
          <motion.div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              width: '40%',
              background: 'linear-gradient(90deg, #0078d4, #00bcf2)',
              borderRadius: '1px',
            }}
            animate={{ left: ['-40%', '100%'] }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}

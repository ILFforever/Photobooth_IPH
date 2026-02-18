import { motion, AnimatePresence } from "framer-motion";
import { Info, FolderOpen, Image as ImageIcon, Sparkles } from "lucide-react";

interface QrInfoModalProps {
  show: boolean;
  onClose: () => void;
}

export function QrInfoModal({ show, onClose }: QrInfoModalProps) {
  if (!show) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="modal confirm-dialog"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: '520px' }}
        >
          <div className="modal-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Info size={20} style={{ color: '#3b82f6' }} />
              <h2>About QR Uploads</h2>
            </div>
          </div>

          <div className="modal-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* How Folders Work - Now First */}
              <div style={{
                padding: '14px',
                background: 'rgba(59, 130, 246, 0.08)',
                borderRadius: '8px',
                border: '1px solid rgba(59, 130, 246, 0.2)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <FolderOpen size={16} style={{ color: '#3b82f6' }} />
                  <h3 style={{ fontSize: '14px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                    How Folders Work
                  </h3>
                </div>
                <p style={{ margin: 0, lineHeight: 1.6, fontSize: '12px', color: 'var(--text-secondary)' }}>
                  When you start a new session, we automatically create a new folder in your Google Drive with the session's name.
                  All photos for that session are stored in this folder, keeping everything organized and easy to find.
                </p>
              </div>

              {/* Upload Methods */}
              <div>
                <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Upload Options
                </h3>

                {/* All Session Photos */}
                <div style={{
                  padding: '12px',
                  background: 'var(--bg-secondary)',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  marginBottom: '10px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <ImageIcon size={14} style={{ color: '#10b981' }} />
                    <h4 style={{ fontSize: '13px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                      All Session Photos
                    </h4>
                  </div>
                  <p style={{ margin: 0, lineHeight: 1.5, fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Every photo taken during the session uploads to Google Drive <strong>immediately after capture</strong>.
                    Guests can scan the QR code and see photos appear as they're being taken - great for instant sharing!
                  </p>
                </div>

                {/* Collage Photos Only */}
                <div style={{
                  padding: '12px',
                  background: 'var(--bg-secondary)',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <Sparkles size={14} style={{ color: '#8b5cf6' }} />
                    <h4 style={{ fontSize: '13px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                      Collage Photos Only
                    </h4>
                  </div>
                  <p style={{ margin: 0, lineHeight: 1.5, fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Only the <strong>final collage</strong> (your finished photo strip) uploads when you press "Next".
                    Individual photos stay private - perfect for keeping behind-the-scenes shots private.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button
              className="button button-secondary"
              onClick={onClose}
              style={{ minWidth: '80px' }}
            >
              Got it
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

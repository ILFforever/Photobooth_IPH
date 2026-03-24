import { motion, AnimatePresence } from "framer-motion";
import { FolderOpen, Plus } from "lucide-react";
import { type PhotoboothSessionInfo } from "../../contexts";
import "../../styles/Modal.css";
import "../../styles/Buttons.css";

interface SessionSelectModalProps {
  isOpen: boolean;
  sessions: PhotoboothSessionInfo[];
  pendingSession: PhotoboothSessionInfo | null;
  onContinue: () => void;
  onCreateNew: () => void;
}

export default function SessionSelectModal({
  isOpen,
  sessions,
  pendingSession,
  onContinue,
  onCreateNew,
}: SessionSelectModalProps) {
  return (
    <AnimatePresence>
      {isOpen && pendingSession && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="modal-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="modal-content"
            style={{
              backgroundColor: '#1a1a1a',
              borderRadius: '12px',
              padding: '32px',
              minWidth: '480px',
              maxWidth: '560px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            }}
          >
            <div style={{ marginBottom: '24px' }}>
              <h2 style={{
                color: '#fff',
                fontSize: '22px',
                fontWeight: 600,
                marginBottom: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}>
                <FolderOpen size={24} style={{ color: '#3b82f6' }} />
                Existing Sessions Found
              </h2>
              <p style={{
                color: '#999',
                fontSize: '15px',
                lineHeight: '1.5',
                margin: 0,
              }}>
                This folder has {sessions.length} existing session{sessions.length > 1 ? 's' : ''}. Would you like to continue the last session or create a new one?
              </p>
            </div>

            {/* Last session info */}
            <div style={{
              backgroundColor: '#252525',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '24px',
              border: '1px solid #333',
            }}>
              <div style={{
                color: '#666',
                fontSize: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '6px',
              }}>Last Session</div>
              <div style={{
                color: '#fff',
                fontSize: '16px',
                fontWeight: 500,
                marginBottom: '4px',
              }}>{pendingSession.name}</div>
              <div style={{
                color: '#888',
                fontSize: '13px',
                display: 'flex',
                gap: '16px',
              }}>
                <span>{pendingSession.shotCount} photos</span>
                <span>•</span>
                <span>{new Date(pendingSession.lastUsedAt).toLocaleDateString()}</span>
              </div>
            </div>

            {/* Action buttons */}
            <div style={{
              display: 'flex',
              gap: '12px',
            }}>
              <button
                onClick={onContinue}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '14px 20px',
                  backgroundColor: '#252525',
                  color: '#fff',
                  border: '1px solid #444',
                  borderRadius: '8px',
                  fontSize: '15px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#333';
                  e.currentTarget.style.borderColor = '#555';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#252525';
                  e.currentTarget.style.borderColor = '#444';
                }}
              >
                <FolderOpen size={18} />
                Continue Last
              </button>
              <button
                onClick={onCreateNew}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '14px 20px',
                  backgroundColor: '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '15px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#2563eb';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#3b82f6';
                }}
              >
                <Plus size={18} />
                Create New Session
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

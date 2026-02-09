import { motion, AnimatePresence } from "framer-motion";
import { useEffect } from "react";
import { ChevronDown, ChevronRight, Calendar, Clock, Image as ImageIcon } from "lucide-react";
import { type PhotoboothSessionInfo } from "../../contexts/PhotoboothSettingsContext";
import { convertFileSrc } from '@tauri-apps/api/core';
import { useToast } from "../../contexts/ToastContext";

interface PhotoSessionsSidebarProps {
  sessions: PhotoboothSessionInfo[];
  selectedSetId: string | null;
  expandedSets: Set<string>;
  hasEverConnected: boolean;
  isCameraConnected: boolean;
  isConnecting: boolean;
  onSetSelect: (setId: string) => void;
  onToggleSet: (setId: string) => void;
  onLoadSession?: (sessionId: string) => void;
  currentSessionId?: string | null;
}

export default function PhotoSessionsSidebar({
  sessions,
  selectedSetId,
  expandedSets,
  hasEverConnected,
  isCameraConnected,
  isConnecting,
  onSetSelect,
  onToggleSet,
  onLoadSession,
  currentSessionId,
}: PhotoSessionsSidebarProps) {
  const { showToast } = useToast();

  const handleLoadSession = (set: PhotoboothSessionInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    onLoadSession?.(set.id);
  };

  const handleToggleExpand = (setId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    onSetSelect(setId);
    onToggleSet(setId);
  };

  // Show toast when camera disconnects (only if it was connected before)
  useEffect(() => {
    if (hasEverConnected && !isCameraConnected && !isConnecting) {
      showToast('Camera Disconnected', 'error', 10000, 'Attempting to reconnect...');
    }
  }, [isCameraConnected, isConnecting, hasEverConnected, showToast]);

  // Show toast when connecting
  useEffect(() => {
    if (isConnecting) {
      showToast('Connecting to Camera', 'info', 3000, 'Please wait...');
    }
  }, [isConnecting, showToast]);
  const selectedSet = sessions.find(set => set.id === selectedSetId);

  return (
    <div className="catalog-sidebar">
      <div className="catalog-header">
        <h2 className="catalog-title">Photo Sessions</h2>
        <span className="catalog-count">{sessions.length} sessions</span>
      </div>

      <div className="catalog-list">
        <AnimatePresence initial={false}>
          {sessions.map((set) => {
            // Format date from createdAt
            const date = new Date(set.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            // Format time from lastUsedAt
            const time = new Date(set.lastUsedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

            return (
              <motion.div
                key={set.id}
                layout
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className={`photo-set-card ${currentSessionId === set.id ? 'active' : ''} ${selectedSetId === set.id ? 'selected' : ''}`}
              >
                <div
                  className="photo-set-header"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => handleToggleExpand(set.id, e)}
                >
                  <div className="photo-set-info">
                    <div className="photo-set-icon">
                      {expandedSets.has(set.id) ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                    </div>
                    <div className="photo-set-details">
                      <span className="photo-set-name">{set.name}</span>
                      <span className="photo-set-meta">
                        {set.shotCount} photos • {date}
                      </span>
                    </div>
                  </div>
                  <div className="photo-set-actions">
                    {currentSessionId !== set.id ? (
                      <button
                        className="load-session-btn"
                        onClick={(e) => handleLoadSession(set, e)}
                      >
                        Load
                      </button>
                    ) : (
                      <div className="current-session-indicator">
                        Active
                      </div>
                    )}
                    <div className="photo-set-time">
                      <Clock size={12} />
                      <span>{time}</span>
                    </div>
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {expandedSets.has(set.id) && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="photo-set-content"
                      style={{ overflow: 'hidden' }}
                    >
                      {set.shotCount > 0 ? (
                        <div className="photo-thumbnails">
                          {set.thumbnails.length > 0 ? (
                            set.thumbnails.map((thumbnail, idx) => (
                              <div key={idx} className="thumbnail-item">
                                <img
                                  src={convertFileSrc(thumbnail.replace('asset://', ''))}
                                  alt={`Photo ${idx + 1}`}
                                  className="thumbnail-image"
                                  loading="lazy"
                                  decoding="async"
                                />
                              </div>
                            ))
                          ) : (
                            // Fallback to placeholders if no thumbnails
                            Array.from({ length: set.shotCount }).map((_, idx) => (
                              <div key={idx} className="thumbnail-placeholder">
                                <ImageIcon size={20} />
                                <span>Photo {idx + 1}</span>
                              </div>
                            ))
                          )}
                        </div>
                      ) : (
                        // Empty state when session has no photos
                        <div className="photo-thumbnails-empty">
                          <ImageIcon size={24} />
                          <span>No photos in this session yet</span>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Selected Set Detail */}
      <AnimatePresence initial={false}>
        {selectedSet && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="selected-set-detail"
            style={{ overflow: 'hidden' }}
          >
            <div className="detail-header">
              <h3>{selectedSet.name}</h3>
            </div>
            <div className="detail-meta">
              <span className="detail-item">
                <Calendar size={12} />
                {new Date(selectedSet.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              <span className="detail-item">
                <Clock size={12} />
                {new Date(selectedSet.lastUsedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="detail-item">
                <ImageIcon size={12} />
                {selectedSet.shotCount} photos
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

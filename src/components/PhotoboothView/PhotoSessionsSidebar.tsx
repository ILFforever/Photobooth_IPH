import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight, Calendar, Clock, Image as ImageIcon, WifiOff, RefreshCw, FolderOpen, X } from "lucide-react";
import { type PhotoboothSessionInfo } from "../../contexts/PhotoboothSettingsContext";
import { convertFileSrc } from '@tauri-apps/api/core';

interface PhotoSessionsSidebarProps {
  sessions: PhotoboothSessionInfo[];
  selectedSetId: string | null;
  expandedSets: Set<string>;
  hasEverConnected: boolean;
  isCameraConnected: boolean;
  isConnecting: boolean;
  showWorkingFolderWarning: boolean;
  showNoCameraWarning: boolean;
  onSetSelect: (setId: string) => void;
  onToggleSet: (setId: string) => void;
  onCloseSetDetail: () => void;
  onDismissWorkingFolderWarning: () => void;
  onDismissNoCameraWarning: () => void;
}

export default function PhotoSessionsSidebar({
  sessions,
  selectedSetId,
  expandedSets,
  hasEverConnected,
  isCameraConnected,
  isConnecting,
  showWorkingFolderWarning,
  showNoCameraWarning,
  onSetSelect,
  onToggleSet,
  onCloseSetDetail,
  onDismissWorkingFolderWarning,
  onDismissNoCameraWarning,
}: PhotoSessionsSidebarProps) {
  const selectedSet = sessions.find(set => set.id === selectedSetId);

  return (
    <div className="catalog-sidebar">
      <div className="catalog-header">
        <h2 className="catalog-title">Photo Sessions</h2>
        <span className="catalog-count">{sessions.length} sessions</span>
      </div>

      <div className="catalog-list">
        <AnimatePresence mode="popLayout">
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
                className={`photo-set-card ${selectedSetId === set.id ? 'selected' : ''}`}
              >
                <button
                  className="photo-set-header"
                  onClick={() => {
                    onSetSelect(set.id);
                    onToggleSet(set.id);
                  }}
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
                  <div className="photo-set-time">
                    <Clock size={12} />
                    <span>{time}</span>
                  </div>
                </button>

                <AnimatePresence>
                  {expandedSets.has(set.id) && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="photo-set-content"
                    >
                      <div className="photo-thumbnails">
                        {set.thumbnails.length > 0 ? (
                          set.thumbnails.map((thumbnail, idx) => (
                            <div key={idx} className="thumbnail-item">
                              <img
                                src={convertFileSrc(thumbnail)}
                                alt={`Photo ${idx + 1}`}
                                className="thumbnail-image"
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
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Selected Set Detail */}
      <AnimatePresence>
        {selectedSet && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="selected-set-detail"
          >
            <div className="detail-header">
              <h3>{selectedSet.name}</h3>
              <button
                className="close-detail"
                onClick={onCloseSetDetail}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
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

      {/* Camera Connection Status Notification - Only show if camera was connected before */}
      <AnimatePresence>
        {hasEverConnected && !isCameraConnected && !isConnecting && (
          <motion.div
            className="connection-status-toast"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
          >
            <WifiOff size={16} className="connection-status-icon" />
            <div className="connection-status-text">
              <span className="connection-status-title">Camera Disconnected</span>
              <span className="connection-status-subtitle">
                <RefreshCw size={12} className="spinning" />
                Retrying connection...
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Camera Connecting Toast */}
      <AnimatePresence>
        {isConnecting && (
          <motion.div
            className="connection-status-toast connecting-toast"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
          >
            <RefreshCw size={16} className="connection-status-icon spinning" />
            <div className="connection-status-text">
              <span className="connection-status-title">Connecting to Camera</span>
              <span className="connection-status-subtitle">
                Please wait...
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Working Folder Warning Toast */}
      <AnimatePresence>
        {showWorkingFolderWarning && (
          <motion.div
            className="connection-status-toast working-folder-warning"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            onClick={onDismissWorkingFolderWarning}
          >
            <FolderOpen size={16} className="connection-status-icon" />
            <div className="connection-status-text">
              <span className="connection-status-title">No Working Folder Set</span>
              <span className="connection-status-subtitle">
                Photos cannot be saved. Set a working folder in Photobooth settings.
              </span>
            </div>
            <button
              className="toast-dismiss-btn"
              onClick={(e) => {
                e.stopPropagation();
                onDismissWorkingFolderWarning();
              }}
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* No Camera Warning Toast */}
      <AnimatePresence>
        {showNoCameraWarning && (
          <motion.div
            className="connection-status-toast no-camera-warning"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            onClick={onDismissNoCameraWarning}
          >
            <WifiOff size={16} className="connection-status-icon" />
            <div className="connection-status-text">
              <span className="connection-status-title">No Camera Connected</span>
              <span className="connection-status-subtitle">
                Connect a camera to capture photos.
              </span>
            </div>
            <button
              className="toast-dismiss-btn"
              onClick={(e) => {
                e.stopPropagation();
                onDismissNoCameraWarning();
              }}
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

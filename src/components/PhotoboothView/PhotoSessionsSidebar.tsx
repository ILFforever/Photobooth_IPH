import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Calendar, Clock, Image as ImageIcon, Folder, Trash2, Unlink } from "lucide-react";
import { type PhotoboothSessionInfo } from "../../contexts/PhotoboothSettingsContext";
import { convertFileSrc } from '@tauri-apps/api/core';
import { useToast } from "../../contexts/ToastContext";
import { usePhotoboothSettings } from "../../contexts/PhotoboothSettingsContext";
import { useUploadQueue } from "../../contexts/UploadQueueContext";
import { UploadQueueStatus } from "./UploadQueueStatus";
import { UploadStatus } from "../../types/uploadQueue";

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
  const { createDriveFolderForSession, deleteDriveFolderForSession, deleteSession } = usePhotoboothSettings();
  const { queueItems, getSessionQueue, retryUpload, cancelUpload, startAutoRefresh, stopAutoRefresh } = useUploadQueue();
  const [deleteConfirmSessionId, setDeleteConfirmSessionId] = useState<string | null>(null);
  const [deleteDriveConfirmSessionId, setDeleteDriveConfirmSessionId] = useState<string | null>(null);
  const [expandedDriveFolders, setExpandedDriveFolders] = useState<Set<string>>(new Set());
  const [creatingDriveFolderForId, setCreatingDriveFolderForId] = useState<string | null>(null);
  const [deletingDriveFolderForId, setDeletingDriveFolderForId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  const handleLoadSession = (set: PhotoboothSessionInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    onLoadSession?.(set.id);
  };

  const handleToggleExpand = (setId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    onSetSelect(setId);

    const isCurrentlyExpanded = expandedSets.has(setId);
    onToggleSet(setId);

    // If this session has a Google Drive folder and is being expanded, start auto-refresh
    const set = sessions.find(s => s.id === setId);
    if (set?.googleDriveMetadata?.folderLink) {
      if (!isCurrentlyExpanded) {
        // Session is being expanded - start auto-refresh
        startAutoRefresh(setId);
      } else {
        // Session is being collapsed - stop auto-refresh if it was started
        if (expandedDriveFolders.has(setId)) {
          stopAutoRefresh();
        }
      }
    }
  };

  const handleCreateDriveFolder = async (set: PhotoboothSessionInfo, e: React.MouseEvent) => {
    e?.stopPropagation();
    setCreatingDriveFolderForId(set.id);
    try {
      await createDriveFolderForSession(set.id, set.name);
    } finally {
      setCreatingDriveFolderForId(null);
    }
  };

  const handleDeleteDriveFolderClick = (set: PhotoboothSessionInfo, e: React.MouseEvent) => {
    e?.stopPropagation();
    setDeleteDriveConfirmSessionId(set.id);
  };

  const handleDeleteDriveFolderConfirm = async (set: PhotoboothSessionInfo, e: React.MouseEvent) => {
    e?.stopPropagation();
    setDeletingDriveFolderForId(set.id);
    try {
      await deleteDriveFolderForSession(set.id, set.googleDriveMetadata.folderId || null, set.name);
      setDeleteDriveConfirmSessionId(null);
    } finally {
      setDeletingDriveFolderForId(null);
    }
  };

  const handleDeleteDriveFolderCancel = (e: React.MouseEvent) => {
    e?.stopPropagation();
    setDeleteDriveConfirmSessionId(null);
  };

  const handleDeleteClick = (set: PhotoboothSessionInfo, e: React.MouseEvent) => {
    e?.stopPropagation();
    setDeleteConfirmSessionId(set.id);
  };

  const handleDeleteConfirm = async (set: PhotoboothSessionInfo, e: React.MouseEvent) => {
    e?.stopPropagation();
    setDeletingSessionId(set.id);
    try {
      await deleteSession(set.id);
      showToast('Session Deleted', 'success', 3000, `Deleted "${set.name}"`);
      setDeleteConfirmSessionId(null);
    } catch (error) {
      showToast('Failed to Delete', 'error', 5000, error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setDeletingSessionId(null);
    }
  };

  const handleDeleteCancel = (e: React.MouseEvent) => {
    e?.stopPropagation();
    setDeleteConfirmSessionId(null);
  };

  const handleToggleDriveFolder = async (sessionId: string, e: React.MouseEvent) => {
    e?.stopPropagation();
    setExpandedDriveFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sessionId)) {
        newSet.delete(sessionId);
      } else {
        newSet.add(sessionId);
      }
      return newSet;
    });
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

  // Helper function to get upload status for a thumbnail by index
  const getThumbnailUploadStatus = (set: PhotoboothSessionInfo, thumbnailIndex: number) => {
    // Check if in Google Drive uploaded images
    const uploadedImage = set.googleDriveMetadata.uploadedImages[thumbnailIndex];
    if (uploadedImage) {
      return { status: 'completed' as const, color: '#10b981', label: 'Uploaded' };
    }

    // Check if in upload queue
    const sessionQueue = queueItems.filter(item => item.sessionId === set.id);
    // Try to match by index (assuming thumbnails are in order)
    const queueItem = sessionQueue.find(item => {
      // Extract index from filename if possible (e.g., "photo_1.jpg" -> index 0)
      const match = item.filename.match(/(\d+)/);
      if (match) {
        const fileIndex = parseInt(match[1]) - 1; // Convert to 0-based index
        return fileIndex === thumbnailIndex;
      }
      return false;
    });

    if (queueItem) {
      switch (queueItem.status) {
        case UploadStatus.UPLOADING:
          return { status: 'uploading' as const, color: '#3b82f6', label: 'Uploading' };
        case UploadStatus.PENDING:
        case UploadStatus.RETRYING:
          return { status: 'pending' as const, color: '#f59e0b', label: 'Pending' };
        case UploadStatus.FAILED:
          return { status: 'failed' as const, color: '#ef4444', label: 'Failed' };
        default:
          return null;
      }
    }

    return null;
  };

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
                            set.thumbnails.map((thumbnail, idx) => {
                              const uploadStatus = getThumbnailUploadStatus(set, idx);

                              return (
                                <div key={idx} className="thumbnail-item">
                                  <img
                                    src={convertFileSrc(thumbnail.replace('asset://', ''))}
                                    alt={`Photo ${idx + 1}`}
                                    className="thumbnail-image"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                  {uploadStatus && (
                                    <div
                                      className="thumbnail-upload-indicator"
                                      style={{
                                        position: 'absolute',
                                        top: '0',
                                        right: '0',
                                        width: '0',
                                        height: '0',
                                        borderStyle: 'solid',
                                        borderWidth: '0 14px 14px 0',
                                        borderColor: `transparent ${uploadStatus.color} transparent transparent`,
                                        zIndex: 1,
                                      }}
                                      title={uploadStatus.label}
                                    />
                                  )}
                                </div>
                              );
                            })
                          ) : (
                            // Fallback to placeholders if no thumbnails
                            Array.from({ length: set.shotCount }).map((_, idx) => {
                              const uploadStatus = getThumbnailUploadStatus(set, idx);

                              return (
                                <div key={idx} className="thumbnail-placeholder">
                                  <ImageIcon size={20} />
                                  <span>Photo {idx + 1}</span>
                                  {uploadStatus && (
                                    <div
                                      className="thumbnail-upload-indicator"
                                      style={{
                                        position: 'absolute',
                                        top: '0',
                                        right: '0',
                                        width: '0',
                                        height: '0',
                                        borderStyle: 'solid',
                                        borderWidth: '0 14px 14px 0',
                                        borderColor: `transparent ${uploadStatus.color} transparent transparent`,
                                        zIndex: 1,
                                      }}
                                      title={uploadStatus.label}
                                    />
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      ) : (
                        // Empty state when session has no photos
                        <div className="photo-thumbnails-empty">
                          <ImageIcon size={24} />
                          <span>No photos in this session yet</span>
                        </div>
                      )}

                      {/* Google Drive Folder Section */}
                      <div className="session-drive-card">
                        <div className="drive-card-header">
                          <div className="drive-card-title">
                            <Folder size={14} />
                            <span>Google Drive</span>
                          </div>
                          {set.googleDriveMetadata.folderLink && (() => {
                            const sessionItems = queueItems.filter(item => item.sessionId === set.id);
                            const stats = {
                              total: sessionItems.length,
                              pending: sessionItems.filter(i => i.status === 'pending' || i.status === 'retrying').length,
                              uploading: sessionItems.filter(i => i.status === 'uploading').length,
                              completed: sessionItems.filter(i => i.status === 'completed').length,
                              failed: sessionItems.filter(i => i.status === 'failed').length,
                            };
                            const hasActivity = stats.total > 0;
                            const isActive = stats.uploading > 0 || stats.pending > 0;

                            return hasActivity ? (
                              <div className="drive-status-badges">
                                {isActive && (
                                  <span className="drive-status-badge badge-active">
                                    {stats.uploading > 0 ? `↑ ${stats.uploading}` : `⏳ ${stats.pending}`}
                                  </span>
                                )}
                                {stats.completed > 0 && (
                                  <span className="drive-status-badge badge-success">
                                    {stats.completed} uploaded
                                  </span>
                                )}
                                {stats.failed > 0 && (
                                  <span className="drive-status-badge badge-error">
                                    ✕ {stats.failed}
                                  </span>
                                )}
                              </div>
                            ) : null;
                          })()}
                        </div>

                        {set.googleDriveMetadata.folderLink ? (
                          <div className="drive-card-content">
                            <button
                              className={`drive-folder-toggle ${expandedDriveFolders.has(set.id) ? 'expanded' : ''}`}
                              onClick={(e) => handleToggleDriveFolder(set.id, e)}
                              title="View upload queue"
                            >
                              <span className="drive-folder-name">{set.googleDriveMetadata.folderName}</span>
                              {expandedDriveFolders.has(set.id) ? (
                                <ChevronDown size={12} />
                              ) : (
                                <ChevronRight size={12} />
                              )}
                            </button>

                            {expandedDriveFolders.has(set.id) && (
                              <div className="drive-queue-container">
                                <UploadQueueStatus
                                  items={queueItems.filter(item => item.sessionId === set.id)}
                                  onRetry={retryUpload}
                                  onCancel={cancelUpload}
                                  uploadedImages={set.googleDriveMetadata?.uploadedImages || []}
                                />
                              </div>
                            )}

                            <div className="drive-card-actions">
                              {deleteDriveConfirmSessionId === set.id ? (
                                <>
                                  <button
                                    className="drive-action-btn danger"
                                    onClick={(e) => handleDeleteDriveFolderConfirm(set, e)}
                                    title="Confirm delete folder"
                                    disabled={deletingDriveFolderForId === set.id}
                                  >
                                    {deletingDriveFolderForId === set.id ? (
                                      <>
                                        <span className="spinner-small"></span>
                                        <span>Deleting...</span>
                                      </>
                                    ) : (
                                      <>
                                        <Trash2 size={12} />
                                        <span>Confirm</span>
                                      </>
                                    )}
                                  </button>
                                  <button
                                    className="drive-action-btn secondary"
                                    onClick={handleDeleteDriveFolderCancel}
                                    title="Cancel"
                                    disabled={deletingDriveFolderForId === set.id}
                                  >
                                    <span>Cancel</span>
                                  </button>
                                </>
                              ) : (
                                <button
                                  className="drive-action-btn secondary"
                                  onClick={(e) => handleDeleteDriveFolderClick(set, e)}
                                  title="Unlink Drive folder"
                                >
                                  <Unlink size={12} />
                                  <span>Unlink</span>
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="drive-card-empty">
                            <p className="drive-empty-message">No Drive folder created</p>
                            <button
                              className="drive-action-btn primary"
                              onClick={(e) => handleCreateDriveFolder(set, e)}
                              disabled={creatingDriveFolderForId === set.id}
                            >
                              {creatingDriveFolderForId === set.id ? (
                                <>
                                  <span className="spinner-small"></span>
                                  <span>Creating...</span>
                                </>
                              ) : (
                                <>
                                  <Folder size={12} />
                                  <span>Create Folder</span>
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Delete Session Section */}
                      <div className="session-delete-section">
                        {deleteConfirmSessionId === set.id ? (
                          // Show confirm/cancel buttons
                          <div className="delete-confirm-buttons">
                            <button
                              className="delete-confirm-btn"
                              onClick={(e) => handleDeleteConfirm(set, e)}
                              disabled={deletingSessionId === set.id}
                            >
                              {deletingSessionId === set.id ? (
                                <>
                                  <span className="spinner-small"></span>
                                  <span>Deleting...</span>
                                </>
                              ) : (
                                <>
                                  <Trash2 size={14} />
                                  <span>Confirm</span>
                                </>
                              )}
                            </button>
                            <button
                              className="delete-cancel-btn"
                              onClick={handleDeleteCancel}
                              disabled={deletingSessionId === set.id}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          // Show delete button
                          <button
                            className="session-delete-btn"
                            onClick={(e) => handleDeleteClick(set, e)}
                            title="Delete session"
                          >
                            <Trash2 size={14} />
                            <span>Delete Session</span>
                          </button>
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

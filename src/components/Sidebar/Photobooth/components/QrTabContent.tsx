import { useState, useEffect, useMemo, useCallback } from 'react';
import { ExternalLink, Copy, Check, Upload, AlertCircle, Folder, XCircle, Loader, ChevronDown, ChevronRight, AlertTriangle, LogIn, QrCode, Image as ImageIcon } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { usePhotoboothSettings } from '../../../../contexts/PhotoboothSettingsContext';
import { useUploadQueue } from '../../../../contexts/UploadQueueContext';
import { useAuth } from '../../../../contexts/AuthContext';
import { usePhotobooth } from '../../../../contexts/PhotoboothContext';
import { useToast } from '../../../../contexts/ToastContext';
import { getDriveAuthState, getAuthStateText, DriveAuthState } from '../../../../utils/driveAuthState';

export function QrTabContent() {
  const { currentSession, workingFolder, sessions } = usePhotoboothSettings();
  const { queueItems, stats, startAutoRefresh, stopAutoRefresh, enqueuePhotos } = useUploadQueue();
  const { account } = useAuth();
  const { exportPhotoboothCanvasAsPNG, currentCollageFilename, setCurrentCollageFilename, collageIsDirty, resetCollageDirtyState, isGeneratingCollage, setIsGeneratingCollage } = usePhotobooth();
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [isUploadingCollage, setIsUploadingCollage] = useState(false);
  const [showRegeneratePrompt, setShowRegeneratePrompt] = useState(false);
  const [pendingUploadAction, setPendingUploadAction] = useState<(() => void) | null>(null);

  const driveMetadata = currentSession?.googleDriveMetadata;
  const folderLink = driveMetadata?.folderLink || '';

  // Compute auth state
  const authStateInfo = useMemo(
    () => getDriveAuthState(driveMetadata || null, account),
    [driveMetadata, account]
  );

  const authStateText = useMemo(
    () => getAuthStateText(authStateInfo.state, authStateInfo.folderOwner, account),
    [authStateInfo, account]
  );

  const hasDriveFolder = authStateInfo.state !== DriveAuthState.NO_FOLDER;

  // Reset QR when session changes
  useEffect(() => {
    setShowQr(false);
    setQrBase64(null);
  }, [currentSession?.id]);

  // Get upload items for current session
  const sessionItems = currentSession ? queueItems.filter(item => item.sessionId === currentSession.id) : [];

  // Group items by status
  const failedItems = sessionItems.filter(i => i.status === 'failed');
  const activeItems = sessionItems.filter(i => i.status === 'uploading' || i.status === 'retrying' || i.status === 'pending');
  const completedItems = sessionItems.filter(i => i.status === 'completed');

  // Also include uploaded images from session metadata (stored in .ptb file from previous sessions)
  const metadataUploadedItems = useMemo(() => {
    if (!currentSession?.googleDriveMetadata?.uploadedImages) return [];
    // Filter out images that are already in the completed queue (avoid duplicates)
    const completedFilenames = new Set(completedItems.map(i => i.filename));
    return currentSession.googleDriveMetadata.uploadedImages
      .filter((img: any) => !completedFilenames.has(img.filename))
      .map((img: any) => ({
        id: `metadata-${img.driveFileId}`,
        filename: img.filename,
        status: 'completed',
        completedAt: img.uploadedAt,
        driveFileId: img.driveFileId,
        fromMetadata: true,
      }));
  }, [currentSession?.googleDriveMetadata?.uploadedImages, completedItems]);

  // Combine queue completed items with metadata uploaded items
  const allCompletedItems = [...completedItems, ...metadataUploadedItems];

  // Only show spinner when there are actually uploading items (not just pending)
  const hasUploadingItems = sessionItems.some(item => item.status === 'uploading' || item.status === 'retrying');

  // Initialize collapsed state based on whether sections have items
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    failed: failedItems.length === 0,
    active: activeItems.length === 0,
    completed: true, // Always start collapsed
  });

  // Auto-expand/collapse sections based on item counts
  useEffect(() => {
    setCollapsedSections(prev => ({
      // Auto-expand active if there are items, auto-collapse if empty
      active: activeItems.length === 0,
      // Auto-expand failed if there are items, auto-collapse if empty
      failed: failedItems.length === 0,
      // Never auto-expand completed (keep user preference or stay collapsed)
      completed: prev.completed,
    }));
  }, [activeItems.length, failedItems.length]);

  const toggleSection = (section: string) => {
    setCollapsedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleCopyLink = async () => {
    if (folderLink) {
      try {
        await navigator.clipboard.writeText(folderLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy link:', err);
      }
    }
  };

  const handleOpenLink = () => {
    if (folderLink) {
      shellOpen(folderLink);
    }
  };

  const handleToggleQr = async () => {
    if (showQr) {
      setShowQr(false);
      return;
    }
    if (!qrBase64 && folderLink) {
      try {
        const data = await invoke<string>('generate_qr_code', { url: folderLink });
        setQrBase64(data);
      } catch (err) {
        console.error('[QrTabContent] Failed to generate QR:', err);
      }
    }
    setShowQr(true);
  };

  // Upload current collage to Google Drive
  const handleUploadCollage = useCallback(async () => {
    if (!currentSession || !workingFolder || !driveMetadata?.folderId) return;

    // Check if another operation is already generating
    if (isGeneratingCollage) {
      showToast('Please wait', 'warning', 2000, 'Collage is being generated...');
      return;
    }

    // Check if we need to prompt for regeneration
    if (currentCollageFilename && collageIsDirty) {
      // Store the pending upload action and show prompt
      setPendingUploadAction(() => async () => {
        await performUpload(currentSession, workingFolder, sessions, driveMetadata);
      });
      setShowRegeneratePrompt(true);
      return;
    }

    // Proceed with normal upload flow
    await performUpload(currentSession, workingFolder, sessions, driveMetadata);
  }, [currentSession, workingFolder, sessions, driveMetadata, currentCollageFilename, collageIsDirty, isGeneratingCollage]);

  // Actual upload execution (extracted for reuse)
  const performUpload = useCallback(async (currentSession: any, workingFolder: string, sessions: any[], driveMetadata: any) => {
    setIsUploadingCollage(true);
    try {
      const sessionFolder = sessions.find(s => s.id === currentSession.id)?.folderName || currentSession.id;
      let filename: string;

      if (currentCollageFilename && !collageIsDirty) {
        // Collage already saved to disk — skip re-export
        filename = currentCollageFilename;
        showToast('Using cached collage', 'success', 2000, currentCollageFilename);
      } else {
        // Set generating state to block other operations
        setIsGeneratingCollage(true);

        // Export collage canvas as PNG
        const exportResult = await exportPhotoboothCanvasAsPNG();
        if (!exportResult) {
          showToast('Not ready yet', 'warning', 2000, 'Please wait for photos to load and try again');
          setIsUploadingCollage(false);
          setIsGeneratingCollage(false);
          return;
        }

        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        const randomStr = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        filename = `Collage_${randomStr}.png`;
        setCurrentCollageFilename(filename);
        resetCollageDirtyState();

        // Save to session folder (upload queue reads from disk)
        await invoke('save_file_to_session_folder', {
          folderPath: workingFolder,
          sessionId: sessionFolder,
          filename,
          fileData: Array.from(exportResult.bytes),
        });

        // Clear generating state after save
        setIsGeneratingCollage(false);
      }

      // Enqueue for upload
      const localPath = `${workingFolder}/${sessionFolder}/${filename}`;
      await enqueuePhotos(currentSession.id, [{ filename, localPath }], driveMetadata.folderId);
    } catch (error) {
      console.error('[QrTabContent] Failed to upload collage:', error);
      showToast('Upload failed', 'error', 5000, error instanceof Error ? error.message : String(error));
    } finally {
      setIsUploadingCollage(false);
    }
  }, [currentCollageFilename, collageIsDirty, exportPhotoboothCanvasAsPNG, enqueuePhotos, setCurrentCollageFilename, resetCollageDirtyState, setIsGeneratingCollage, showToast, workingFolder, sessions, driveMetadata, currentSession]);

  const confirmRegenerate = useCallback(() => {
    setShowRegeneratePrompt(false);
    if (pendingUploadAction) {
      pendingUploadAction();
      setPendingUploadAction(null);
    }
  }, [pendingUploadAction]);

  const cancelRegenerate = useCallback(() => {
    setShowRegeneratePrompt(false);
    setPendingUploadAction(null);
  }, []);

  // Auto-refresh upload queue for current session
  useEffect(() => {
    if (currentSession?.id) {
      console.log('[QrTabContent] Starting auto-refresh for session:', currentSession.id);
      startAutoRefresh(currentSession.id);
      return () => {
        console.log('[QrTabContent] Stopping auto-refresh');
        stopAutoRefresh();
      };
    }
  }, [currentSession?.id, startAutoRefresh, stopAutoRefresh]);

  if (!currentSession) {
    return (
      <div className="print-settings-container">
        <div className="print-section">
          <div className="print-section-header">
            <AlertCircle size={16} />
            <span className="print-section-title">No Active Session</span>
          </div>
          <div className="print-info-content">
            <p>Please create or select a session to view uploads.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!hasDriveFolder) {
    return (
      <div className="print-settings-container">
        <div className="print-section">
          <div className="print-section-header">
            <Folder size={16} />
            <span className="print-section-title">Google Drive Not Configured</span>
          </div>
          <div className="print-info-content">
            <p>Create a Google Drive folder for this session to enable uploads.</p>
            <p className="print-hint">Go to the Photo Sessions sidebar and click "Create Folder" for this session.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="qr-tab-container">
      {/* Warning/Status banner based on auth state */}
      {authStateInfo.state !== DriveAuthState.AUTHENTICATED_MATCHING && (
        <div className={`usb-warning-banner ${authStateInfo.state === DriveAuthState.AUTHENTICATED_MISMATCH ? 'warning-mismatch' : ''}`}>
          {authStateInfo.state === DriveAuthState.AUTHENTICATED_MISMATCH ? (
            <AlertTriangle size={14} className="warning-icon" />
          ) : (
            <LogIn size={14} className="warning-icon" />
          )}
          <div className="warning-text">
            <strong>{authStateText.title}:</strong> {authStateText.message}
          </div>
        </div>
      )}

      {/* Connected status badge when authenticated */}
      {authStateInfo.state === DriveAuthState.AUTHENTICATED_MATCHING && (
        <div className="qr-connected-badge">
          <Check size={12} />
          <span>{authStateText.title}: {account?.email}</span>
        </div>
      )}

      {/* Drive Folder Section */}
      <div className="qr-code-section">
        <div className="qr-code-header">
          <Folder size={14} />
          <span className="qr-section-title">Google Drive Folder</span>
        </div>

        <div className="qr-folder-info">
          <div className="qr-folder-name">
            <span>{driveMetadata?.folderName || 'Unknown'}</span>
          </div>

          <div className="qr-folder-actions">
            <button
              className="qr-action-btn secondary"
              onClick={handleCopyLink}
              title="Copy link to clipboard"
              disabled={!authStateText.canViewLink}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              <span>{copied ? 'Copied!' : 'Copy Link'}</span>
            </button>
            <button
              className={`qr-action-btn secondary ${showQr ? 'active' : ''}`}
              onClick={handleToggleQr}
              title="Show QR code"
              disabled={!authStateText.canViewLink}
            >
              <QrCode size={12} />
              <span>Show QR</span>
              <ChevronDown size={10} style={{ transform: showQr ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>
          </div>
        </div>

        {showQr && qrBase64 && (
          <div className="qr-code-dropdown">
            <div className="qr-code-dropdown-frame">
              <img
                src={`data:image/png;base64,${qrBase64}`}
                alt="QR Code"
                className="qr-code-dropdown-img"
              />
            </div>
            <span className="qr-code-dropdown-label">SCAN FOR PHOTOS</span>
            <button
              className="qr-action-btn secondary"
              onClick={handleOpenLink}
              title="Open in Google Drive"
              style={{ alignSelf: 'stretch', justifyContent: 'center' }}
            >
              <ExternalLink size={12} />
              <span>Open in Drive</span>
            </button>
          </div>
        )}
      </div>

      {/* Upload Collage Button */}
      <div className="qr-upload-collage-section">
        <button
          className="qr-upload-collage-btn"
          onClick={handleUploadCollage}
          disabled={isUploadingCollage || !driveMetadata?.folderId}
          title="Export and upload the current collage to Google Drive"
        >
          {isUploadingCollage ? (
            <Loader size={14} className="spinning" />
          ) : (
            <ImageIcon size={14} />
          )}
          <span>{isUploadingCollage ? 'Uploading...' : 'Upload Collage to Drive'}</span>
        </button>
      </div>

      {/* Upload Status Section */}
      <div className="qr-upload-status">
        <div className="qr-status-header">
          <Upload size={14} />
          <span className="qr-section-title">Upload Status</span>
          <div className="qr-upload-summary">
            <span className="qr-upload-count">{allCompletedItems.length}</span>
            <span>uploaded</span>
          </div>
        </div>

        {sessionItems.length === 0 && metadataUploadedItems.length === 0 ? (
          <div className="qr-upload-empty">
            <Upload size={16} />
            <span>No uploads yet</span>
          </div>
        ) : (
          <div className="qr-upload-sections">
            {/* Active Items */}
            <UploadSection
              title="Active"
              count={activeItems.length}
              icon={hasUploadingItems ? <Loader size={12} className="spinning" /> : <Upload size={12} />}
              collapsed={collapsedSections.active}
              onToggle={() => toggleSection('active')}
              status="active"
            >
              {activeItems.length > 0 ? (
                activeItems.map(item => (
                  <MinimalUploadItem key={item.id} item={item} />
                ))
              ) : (
                <div className="qr-section-empty">No active uploads</div>
              )}
            </UploadSection>

            {/* Failed Items */}
            <UploadSection
              title="Failed"
              count={failedItems.length}
              icon={<XCircle size={12} />}
              collapsed={collapsedSections.failed}
              onToggle={() => toggleSection('failed')}
              status="failed"
            >
              {failedItems.length > 0 ? (
                failedItems.map(item => (
                  <MinimalUploadItem key={item.id} item={item} />
                ))
              ) : (
                <div className="qr-section-empty">No failed uploads</div>
              )}
            </UploadSection>

            {/* Completed Items */}
            <UploadSection
              title="Completed"
              count={allCompletedItems.length}
              icon={<Check size={12} />}
              collapsed={collapsedSections.completed}
              onToggle={() => toggleSection('completed')}
              status="completed"
            >
              {allCompletedItems.length > 0 ? (
                allCompletedItems.map(item => (
                  <MinimalUploadItem key={item.id} item={item} />
                ))
              ) : (
                <div className="qr-section-empty">No completed uploads</div>
              )}
            </UploadSection>
          </div>
        )}
      </div>

      {/* Regenerate Collage Prompt Modal */}
      {showRegeneratePrompt && (
        <div className="regenerate-modal-overlay" onClick={cancelRegenerate}>
          <div className="regenerate-modal" onClick={(e) => e.stopPropagation()}>
            <div className="regenerate-modal-header">
              <AlertCircle size={18} className="regenerate-modal-icon" />
              <h3>Collage Modified</h3>
            </div>
            <div className="regenerate-modal-content">
              <p>The collage has been modified since it was last exported.</p>
              <p>Would you like to generate a new image with your changes?</p>
            </div>
            <div className="regenerate-modal-actions">
              <button className="regenerate-modal-btn secondary" onClick={cancelRegenerate}>
                <span>Use Old Version</span>
              </button>
              <button className="regenerate-modal-btn primary" onClick={confirmRegenerate}>
                <ImageIcon size={14} />
                <span>Generate New</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface UploadSectionProps {
  title: string;
  count: number;
  icon: React.ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  status: string;
  children: React.ReactNode;
}

function UploadSection({ title, count, icon, collapsed, onToggle, status, children }: UploadSectionProps) {
  return (
    <div className={`qr-upload-section ${status}`}>
      <button
        className="qr-upload-section-header"
        onClick={onToggle}
      >
        <span className="qr-section-toggle">
          {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
        </span>
        <span className="qr-section-icon">{icon}</span>
        <span className="qr-section-title-text">{title}</span>
        <span className="qr-section-count">{count}</span>
      </button>
      {!collapsed && (
        <div className="qr-upload-section-items">
          {children}
        </div>
      )}
    </div>
  );
}

interface MinimalUploadItemProps {
  item: any;
}

function MinimalUploadItem({ item }: MinimalUploadItemProps) {
  const getTooltip = () => {
    if (item.status === 'completed' && item.completedAt) {
      // For metadata items, show "from previous session" indicator
      if (item.fromMetadata) {
        return `Uploaded from previous session\nCompleted: ${new Date(item.completedAt).toLocaleTimeString()}`;
      }
      const duration = item.startedAt
        ? ` (${Math.round((new Date(item.completedAt).getTime() - new Date(item.startedAt).getTime()) / 1000)}s)`
        : '';
      return `Successfully uploaded to Google Drive${duration}\nCompleted: ${new Date(item.completedAt).toLocaleTimeString()}`;
    }
    if (item.status === 'failed' && item.error) {
      return item.error;
    }
    return undefined;
  };

  return (
    <div className={`qr-upload-item-minimal ${item.status}`} title={getTooltip()}>
      <span className="qr-item-name">{item.filename}</span>
      {(item.status === 'uploading' || item.status === 'retrying') && (
        <div className="qr-item-progress-wrapper">
          <div className="qr-item-progress-bar">
            <div className="qr-item-progress-fill" style={{ width: `${item.progress}%` }} />
          </div>
          <span className="qr-item-progress-text">{item.progress}%</span>
        </div>
      )}
      {item.status === 'pending' && (
        <span className="qr-item-status-text">Waiting...</span>
      )}
      {item.status === 'failed' && (
        <span className="qr-item-status-text failed">Failed</span>
      )}
      {item.status === 'completed' && (
        <span className="qr-item-status-text completed">Done</span>
      )}
    </div>
  );
}

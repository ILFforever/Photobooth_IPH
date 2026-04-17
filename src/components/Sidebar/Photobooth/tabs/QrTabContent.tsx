import "./QrTabContent.css";
import { useState, useEffect, useMemo, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { emitTo } from '@tauri-apps/api/event';
import { ExternalLink, Copy, Check, Upload, AlertCircle, Folder, XCircle, Loader, ChevronDown, ChevronRight, AlertTriangle, LogIn, QrCode, Image as ImageIcon, ChevronUp } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { useWorkspaceSettings, usePhotoboothSession } from '../../../../contexts';
import type { DisplayLayout } from '../../../../types/displayLayout';
import { useUploadQueue } from '../../../../contexts';
import { useAuth } from '../../../../contexts';
import { usePhotobooth } from '../../../../contexts';
import { useToast } from '../../../../contexts';
import { useCollageUpload } from '../../../../hooks/useCollageUpload';
import { getDriveAuthState, getAuthStateText, DriveAuthState, areUploadsEnabled } from '../../../../utils/driveAuthState';
import { createLogger } from '../../../../utils/logger';

const logger = createLogger('QrTabContent');

export function QrTabContent() {
  const { workingFolder, qrUploadEnabled, selectedDisplayLayoutId } = useWorkspaceSettings();
  const { currentSession, sessions } = usePhotoboothSession();
  const { queueItems, stats, startAutoRefresh, stopAutoRefresh } = useUploadQueue();
  const { account } = useAuth();
  const { currentCollageFilename, collageIsDirty } = usePhotobooth();
  const { showToast } = useToast();
  const { uploadCollage, isUploading: isUploadingCollage } = useCollageUpload();
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [showRegenerateOptions, setShowRegenerateOptions] = useState(false);

  const driveMetadata = currentSession?.googleDriveMetadata;
  const folderLink = driveMetadata?.folderLink || '';

  // Load the selected display layout for the guest display at finalize time
  const getSelectedDisplayLayout = useCallback(async (): Promise<DisplayLayout | null> => {
    if (!selectedDisplayLayoutId) return null;
    try {
      return await invoke<DisplayLayout>('get_display_layout', { layoutId: selectedDisplayLayoutId });
    } catch (err) {
      logger.error('[QrTabContent] Failed to load display layout:', err);
      return null;
    }
  }, [selectedDisplayLayoutId]);

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
        logger.error('Failed to copy link:', err);
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
        logger.error('[QrTabContent] Failed to generate QR:', err);
      }
    }
    setShowQr(true);
  };

  // Upload current collage to Google Drive
  const handleUploadCollage = useCallback(async () => {
    if (!currentSession || !workingFolder || !driveMetadata?.folderId) return;

    // Block uploads if QR upload is disabled
    if (!qrUploadEnabled) {
      showToast('Upload Disabled', 'warning', 3000, 'QR upload is disabled in settings.');
      return;
    }

    // Block uploads on account mismatch or not authenticated
    if (!areUploadsEnabled(authStateInfo.state)) {
      showToast('Upload Blocked', 'error', 4000, authStateText.title + ': ' + authStateText.message);
      return;
    }

    // Check if we need to prompt for regeneration
    // Only show prompt if collage hasn't been auto-uploaded yet this session
    const hasAutoUploadedThisSession = currentSession?.googleDriveMetadata?.uploadedImages?.some(
      img => img.filename === currentCollageFilename
    );

    if (currentCollageFilename && collageIsDirty && !hasAutoUploadedThisSession) {
      // Toggle expansion for regeneration options
      setShowRegenerateOptions(!showRegenerateOptions);
      return;
    }

    // Ensure QR code is generated BEFORE proceeding
    let qrDataToSend = qrBase64;
    if (!qrDataToSend && folderLink) {
      try {
        const data = await invoke<string>('generate_qr_code', { url: folderLink });
        qrDataToSend = data;
        setQrBase64(data);
      } catch (err) {
        logger.error('[QrTabContent] Failed to generate QR:', err);
      }
    }

    // Proceed with normal upload flow
    const displayLayout = await getSelectedDisplayLayout();
    await uploadCollage(currentSession, workingFolder, sessions, driveMetadata, async (_, imageUrl) => {
      emitTo("guest-display", "guest-display:update", {
        displayMode: 'finalize' as const,
        finalizeImageUrl: imageUrl,
        finalizeQrData: qrDataToSend || null,
        displayLayout,
      });
    });
  }, [currentSession, workingFolder, sessions, driveMetadata, currentCollageFilename, collageIsDirty, authStateInfo.state, authStateText, qrUploadEnabled, uploadCollage, showToast, showRegenerateOptions, folderLink, qrBase64, getSelectedDisplayLayout]);

  const confirmRegenerate = useCallback(async () => {
    setShowRegenerateOptions(false);
    if (currentSession && workingFolder && driveMetadata) {
      let qrDataToSend = qrBase64;
      if (!qrDataToSend && folderLink) {
        try {
          const data = await invoke<string>('generate_qr_code', { url: folderLink });
          qrDataToSend = data;
          setQrBase64(data);
        } catch (err) {
          logger.error('[QrTabContent] Failed to generate QR:', err);
        }
      }

      const displayLayout = await getSelectedDisplayLayout();
      await uploadCollage(currentSession, workingFolder, sessions, driveMetadata, async (_, imageUrl) => {
        emitTo("guest-display", "guest-display:update", {
          displayMode: 'finalize' as const,
          finalizeImageUrl: imageUrl,
          finalizeQrData: qrDataToSend || null,
          displayLayout,
        });
      });
    }
  }, [currentSession, workingFolder, sessions, driveMetadata, uploadCollage, folderLink, qrBase64, getSelectedDisplayLayout]);

  const cancelRegenerate = useCallback(async () => {
    setShowRegenerateOptions(false);
    if (currentSession && workingFolder && driveMetadata) {
      let qrDataToSend = qrBase64;
      if (!qrDataToSend && folderLink) {
        try {
          const data = await invoke<string>('generate_qr_code', { url: folderLink });
          qrDataToSend = data;
          setQrBase64(data);
        } catch (err) {
          logger.error('[QrTabContent] Failed to generate QR:', err);
        }
      }

      const displayLayout = await getSelectedDisplayLayout();
      await uploadCollage(currentSession, workingFolder, sessions, driveMetadata, async (_, imageUrl) => {
        emitTo("guest-display", "guest-display:update", {
          displayMode: 'finalize' as const,
          finalizeImageUrl: imageUrl,
          finalizeQrData: qrDataToSend || null,
          displayLayout,
        });
      });
    }
  }, [currentSession, workingFolder, sessions, driveMetadata, uploadCollage, folderLink, qrBase64, getSelectedDisplayLayout]);

  // Auto-refresh upload queue for current session
  useEffect(() => {
    if (currentSession?.id) {
      logger.debug('[QrTabContent] Starting auto-refresh for session:', currentSession.id);
      startAutoRefresh(currentSession.id);
      return () => {
        logger.debug('[QrTabContent] Stopping auto-refresh');
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
          className={`qr-upload-collage-btn ${collageIsDirty && showRegenerateOptions ? 'expanded' : ''}`}
          onClick={handleUploadCollage}
          disabled={isUploadingCollage || !driveMetadata?.folderId}
          title="Export and upload the current collage to Google Drive"
        >
          {isUploadingCollage ? (
            <Loader size={14} className="spinning" />
          ) : collageIsDirty ? (
            <AlertCircle size={14} className="dirty-icon" />
          ) : (
            <ImageIcon size={14} />
          )}
          <span>{isUploadingCollage ? 'Uploading...' : collageIsDirty ? 'Collage Modified' : 'Upload Collage to Drive'}</span>
          {collageIsDirty && !isUploadingCollage && (
            showRegenerateOptions ? <ChevronUp size={12} /> : <ChevronDown size={12} />
          )}
        </button>

        {/* Inline regeneration options */}
        {collageIsDirty && showRegenerateOptions && (
          <div className="qr-regenerate-options">
            <p className="qr-regenerate-text">The collage has been modified since it was last exported. Would you like to generate a new image with your changes?</p>
            <div className="qr-regenerate-actions">
              <button
                className="qr-regenerate-btn secondary"
                onClick={cancelRegenerate}
                disabled={isUploadingCollage}
              >
                Use Old Version
              </button>
              <button
                className="qr-regenerate-btn primary"
                onClick={confirmRegenerate}
                disabled={isUploadingCollage}
              >
                <ImageIcon size={12} />
                Generate New
              </button>
            </div>
          </div>
        )}
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

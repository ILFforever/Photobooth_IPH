import { useState, useEffect, useMemo } from 'react';
import { ExternalLink, Copy, Check, Upload, AlertCircle, Folder, Clock, XCircle, Loader, ChevronDown, ChevronRight, AlertTriangle, LogIn } from 'lucide-react';
import { usePhotoboothSettings } from '../../../../contexts/PhotoboothSettingsContext';
import { useUploadQueue } from '../../../../contexts/UploadQueueContext';
import { useAuth } from '../../../../contexts/AuthContext';
import { getDriveAuthState, getAuthStateText, DriveAuthState } from '../../../../utils/driveAuthState';

export function QrTabContent() {
  const { currentSession } = usePhotoboothSettings();
  const { queueItems, stats, startAutoRefresh, stopAutoRefresh } = useUploadQueue();
  const { account } = useAuth();
  const [copied, setCopied] = useState(false);

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

  // Get upload items for current session
  const sessionItems = currentSession ? queueItems.filter(item => item.sessionId === currentSession.id) : [];

  // Group items by status
  const failedItems = sessionItems.filter(i => i.status === 'failed');
  const activeItems = sessionItems.filter(i => i.status === 'uploading' || i.status === 'retrying' || i.status === 'pending');
  const completedItems = sessionItems.filter(i => i.status === 'completed');

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
      window.open(folderLink, '_blank');
    }
  };

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
              className="qr-action-btn primary"
              onClick={handleOpenLink}
              title="Open in Google Drive"
              disabled={!authStateText.canViewLink}
            >
              <ExternalLink size={12} />
              <span>Open</span>
            </button>
          </div>
        </div>
      </div>

      {/* Upload Status Section */}
      <div className="qr-upload-status">
        <div className="qr-status-header">
          <Upload size={14} />
          <span className="qr-section-title">Upload Status</span>
          <div className="qr-upload-summary">
            <span className="qr-upload-count">{completedItems.length}</span>
            <span>uploaded</span>
          </div>
        </div>

        {sessionItems.length === 0 ? (
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
              count={completedItems.length}
              icon={<Check size={12} />}
              collapsed={collapsedSections.completed}
              onToggle={() => toggleSection('completed')}
              status="completed"
            >
              {completedItems.length > 0 ? (
                completedItems.map(item => (
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

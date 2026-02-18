import { useState, useEffect } from 'react';
import { Clock, Upload, CheckCircle, XCircle, RefreshCw, X, ChevronDown, ChevronRight, Loader } from 'lucide-react';
import type { UploadQueueItem, UploadStatus } from '../../types/uploadQueue';

interface UploadQueueStatusProps {
  items: UploadQueueItem[];
  onRetry: (itemId: string) => void;
  onCancel: (itemId: string) => void;
}

export function UploadQueueStatus({ items, onRetry, onCancel }: UploadQueueStatusProps) {
  // Group items by status
  const failedItems = items.filter(item => item.status === 'failed');
  const activeItems = items.filter(item => item.status === 'uploading' || item.status === 'retrying' || item.status === 'pending');
  const completedItems = items.filter(item => item.status === 'completed');

  // Only show spinner when there are actually uploading items (not just pending)
  const hasUploadingItems = items.some(item => item.status === 'uploading' || item.status === 'retrying');

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    active: activeItems.length === 0,
    failed: failedItems.length === 0,
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

  if (items.length === 0) {
    return (
      <div className="upload-queue-empty">
        <Upload size={24} />
        <span>No uploads queued</span>
        <span className="upload-queue-hint">Photos will appear here when they are added to the upload queue</span>
      </div>
    );
  }

  const toggleSection = (section: string) => {
    setCollapsedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  return (
    <div className="upload-queue-status">
      {/* Collapsible Sections */}
      <div className="upload-queue-sections">
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
              <MinimalUploadItem key={item.id} item={item} onRetry={onRetry} onCancel={onCancel} />
            ))
          ) : (
            <div className="upload-section-empty">No active uploads</div>
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
              <MinimalUploadItem key={item.id} item={item} onRetry={onRetry} onCancel={onCancel} />
            ))
          ) : (
            <div className="upload-section-empty">No failed uploads</div>
          )}
        </UploadSection>

        {/* Completed Items */}
        <UploadSection
          title="Completed"
          count={completedItems.length}
          icon={<CheckCircle size={12} />}
          collapsed={collapsedSections.completed}
          onToggle={() => toggleSection('completed')}
          status="completed"
        >
          {completedItems.length > 0 ? (
            completedItems.map(item => (
              <MinimalUploadItem key={item.id} item={item} onRetry={onRetry} onCancel={onCancel} />
            ))
          ) : (
            <div className="upload-section-empty">No completed uploads</div>
          )}
        </UploadSection>
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
    <div className={`upload-queue-section ${status}`}>
      <button
        className="upload-queue-section-header"
        onClick={onToggle}
      >
        <span className="upload-section-toggle">
          {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
        </span>
        <span className="upload-section-icon">{icon}</span>
        <span className="upload-section-title-text">{title}</span>
        <span className="upload-section-count">{count}</span>
      </button>
      {!collapsed && (
        <div className="upload-queue-section-items">
          {children}
        </div>
      )}
    </div>
  );
}

interface MinimalUploadItemProps {
  item: UploadQueueItem;
  onRetry: (itemId: string) => void;
  onCancel: (itemId: string) => void;
}

function MinimalUploadItem({ item, onRetry, onCancel }: MinimalUploadItemProps) {
  const getTooltip = () => {
    if (item.status === 'completed' && item.completedAt) {
      const duration = item.startedAt
        ? ` (${Math.round((new Date(item.completedAt).getTime() - new Date(item.startedAt).getTime()) / 1000)}s)`
        : '';
      return `Successfully uploaded to Google Drive${duration}\nCompleted: ${formatTime(item.completedAt)}`;
    }
    if (item.status === 'failed' && item.error) {
      return item.error;
    }
    return undefined;
  };

  return (
    <div className={`upload-queue-item-minimal ${item.status}`} title={getTooltip()}>
      <span className="upload-item-name">{item.filename}</span>
      {(item.status === 'uploading' || item.status === 'retrying') && (
        <div className="upload-item-progress-wrapper">
          <div className="upload-item-progress-bar">
            <div className="upload-item-progress-fill" style={{ width: `${item.progress}%` }} />
          </div>
          <span className="upload-item-progress-text">{item.progress}%</span>
        </div>
      )}
      {item.status === 'pending' && (
        <span className="upload-item-status-text">Waiting...</span>
      )}
      {item.status === 'failed' && (
        <div className="upload-item-failed-wrapper">
          <span className="upload-item-status-text failed">Failed</span>
          <button
            className="upload-item-retry-btn"
            onClick={() => onRetry(item.id)}
            title="Retry upload"
          >
            <RefreshCw size={10} />
          </button>
        </div>
      )}
      {item.status === 'completed' && (
        <span className="upload-item-status-text completed">Done</span>
      )}
      {item.status === 'pending' && (
        <button
          className="upload-item-cancel-btn"
          onClick={() => onCancel(item.id)}
          title="Cancel upload"
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);

  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
  return date.toLocaleTimeString();
}

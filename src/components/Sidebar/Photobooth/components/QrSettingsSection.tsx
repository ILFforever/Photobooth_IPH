import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import type { DriveFolder } from '../../../../types/qr';

interface QrSettingsSectionProps {
  expanded: boolean;
  onToggle: () => void;
  sessionDriveRootFolder: DriveFolder | null;
  isLoadingDriveFolder: boolean;
  onOpenDriveFolderPicker: () => void;
  qrUploadAllImages: boolean;
  setQrUploadAllImages: (value: boolean) => void;
  onShowInfo: () => void;
}

export function QrSettingsSection({
  expanded,
  onToggle,
  sessionDriveRootFolder,
  isLoadingDriveFolder,
  onOpenDriveFolderPicker,
  qrUploadAllImages,
  setQrUploadAllImages,
  onShowInfo,
}: QrSettingsSectionProps) {
  return (
    <div className="collapsible-section">
      <button
        className="collapsible-header"
        onClick={onToggle}
      >
        <div className="collapsible-header-left">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="collapsible-title">QR Settings</span>
        </div>
        {sessionDriveRootFolder ? (
          <span className="collapsible-badge">
            {sessionDriveRootFolder.name}
          </span>
        ) : (
          <span className="collapsible-badge badge-empty">Not Set</span>
        )}
      </button>
      {expanded && (
        <div className="collapsible-content">
          {/* Info Banner */}
          <div className="qr-info-banner">
            <Info size={14} className="info-icon" />
            <div className="info-text">
              <strong>How it works:</strong> Each session creates a new folder in Google Drive. Photos upload automatically based on your chosen mode. <button className="info-learn-more" onClick={onShowInfo}>Learn more</button>
            </div>
          </div>

          <div className="setting-label-full" style={{ marginBottom: '8px' }}>
            QR Folder
          </div>
          <div className="setting-hint" style={{ marginBottom: '12px' }}>
            Select the Google Drive root folder where session photos will be uploaded for QR sharing.
          </div>
          <div className="setting-cell setting-cell-static" style={{ marginBottom: '8px' }}>
            <span className="setting-label">FOLDER</span>
            <span className="setting-value">
              {sessionDriveRootFolder ? sessionDriveRootFolder.name : 'No folder selected'}
            </span>
          </div>
          <button
            className="folder-browse-btn"
            onClick={onOpenDriveFolderPicker}
            disabled={isLoadingDriveFolder}
          >
            {isLoadingDriveFolder ? (
              <span className="loading-dots">
                <span className="dot"></span>
                <span className="dot"></span>
                <span className="dot"></span>
              </span>
            ) : (
              sessionDriveRootFolder ? 'Change Folder...' : 'Select Folder...'
            )}
          </button>
          {sessionDriveRootFolder && (
            <div className="setting-hint" style={{ marginTop: '8px' }}>
              Each session will create a unique subfolder in "{sessionDriveRootFolder.name}"
            </div>
          )}
                <div className="sidebar-divider" />

          {/* Upload Preference Toggle */}
          <div style={{ marginTop: '20px' }}>
            <div className="setting-label-full" style={{ marginBottom: '8px' }}>
              Upload to Drive
            </div>
            <div className="setting-hint" style={{ marginBottom: '12px' }}>
              Choose which photos to upload to Google Drive for QR code access.
            </div>
            <div className="setting-option-group">
              <button
                className={`setting-option-btn ${qrUploadAllImages ? 'setting-option-selected' : ''}`}
                onClick={() => setQrUploadAllImages(true)}
              >
                All Session Photos
              </button>
              <button
                className={`setting-option-btn ${!qrUploadAllImages ? 'setting-option-selected' : ''}`}
                onClick={() => setQrUploadAllImages(false)}
              >
                Collage Photos Only
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

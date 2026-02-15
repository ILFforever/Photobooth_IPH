import { ChevronDown, ChevronRight } from 'lucide-react';
import type { DriveFolder } from '../../../../types/qr';

interface QrSettingsSectionProps {
  expanded: boolean;
  onToggle: () => void;
  sessionDriveRootFolder: DriveFolder | null;
  isLoadingDriveFolder: boolean;
  onOpenDriveFolderPicker: () => void;
}

export function QrSettingsSection({
  expanded,
  onToggle,
  sessionDriveRootFolder,
  isLoadingDriveFolder,
  onOpenDriveFolderPicker,
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
        {sessionDriveRootFolder && (
          <span className="collapsible-badge">
            {sessionDriveRootFolder.name}
          </span>
        )}
      </button>
      {expanded && (
        <div className="collapsible-content">
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
        </div>
      )}
    </div>
  );
}

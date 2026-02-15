import { ChevronDown, ChevronRight } from 'lucide-react';

interface WorkingFolderSectionProps {
  expanded: boolean;
  onToggle: () => void;
  workingFolder: string | null;
  onBrowseFolder: () => void;
}

export function WorkingFolderSection({
  expanded,
  onToggle,
  workingFolder,
  onBrowseFolder,
}: WorkingFolderSectionProps) {
  return (
    <div className="collapsible-section">
      <button
        className="collapsible-header"
        onClick={onToggle}
      >
        <div className="collapsible-header-left">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="collapsible-title">Working Folder</span>
        </div>
      </button>
      {expanded && (
        <div className="collapsible-content">
          <div className="setting-cell setting-cell-static">
            <span className="setting-label">LOCATION</span>
            <span className="setting-value">
              {workingFolder || 'No folder selected'}
            </span>
          </div>
          <button className="folder-browse-btn" onClick={onBrowseFolder}>
            Browse...
          </button>
        </div>
      )}
    </div>
  );
}

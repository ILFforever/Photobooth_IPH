import { ChevronDown, ChevronRight, Info } from 'lucide-react';

interface NamingSchemeSectionProps {
  expanded: boolean;
  onToggle: () => void;
  photoNamingScheme: string;
  onPhotoNamingSchemeChange: (value: string) => void;
}

export function NamingSchemeSection({
  expanded,
  onToggle,
  photoNamingScheme,
  onPhotoNamingSchemeChange,
}: NamingSchemeSectionProps) {
  return (
    <div className="collapsible-section">
      <button
        className="collapsible-header"
        onClick={onToggle}
      >
        <div className="collapsible-header-left">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="collapsible-title">Naming Scheme</span>
        </div>
      </button>
      {expanded && (
        <div className="collapsible-content">
          <div className="setting-label-full" style={{ marginBottom: '8px' }}>
            Photo Naming Pattern
          </div>
          <input
            type="text"
            className="property-input"
            value={photoNamingScheme}
            onChange={(e) => onPhotoNamingSchemeChange(e.target.value)}
            placeholder="IPH_{number}"
            style={{ width: '100%' }}
          />
          <div className="qr-info-banner" style={{ marginBottom: 0, marginTop: '8px' }}>
            <Info size={14} className="info-icon" />
            <div className="info-text">
              The counter resets to <strong>0001</strong> at the start of each session.
            </div>
          </div>
          <div className="naming-scheme-hints">
            <div className="naming-scheme-hint-row">
              <code className="naming-scheme-token">{'{number}'}</code>
              <span>inserts a 4-digit counter — e.g., <code className="naming-scheme-example">IPH_0001</code></span>
            </div>
            <div className="naming-scheme-hint-row">
              <code className="naming-scheme-token">omitted</code>
              <span>number is appended automatically — e.g., <code className="naming-scheme-example">IPH_0001</code></span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

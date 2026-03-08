import { ChevronDown, ChevronRight } from 'lucide-react';

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
          <div className="setting-hint" style={{ marginTop: '8px' }}>
            Use {'{number}'} as placeholder for 4-digit number (e.g., IPH_0001)
          </div>
        </div>
      )}
    </div>
  );
}

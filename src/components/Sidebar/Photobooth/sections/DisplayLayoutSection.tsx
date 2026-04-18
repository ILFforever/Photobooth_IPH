import { ChevronDown, ChevronRight, Monitor } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { DisplayLayoutPreview } from '../../../../types/displayLayout';

interface DisplayLayoutSectionProps {
  expanded: boolean;
  onToggle: () => void;
  layouts: DisplayLayoutPreview[];
  selectedDisplayLayoutId: string | null;
  onSelectLayout: (id: string | null) => void;
}

export function DisplayLayoutSection({
  expanded,
  onToggle,
  layouts,
  selectedDisplayLayoutId,
  onSelectLayout,
}: DisplayLayoutSectionProps) {
  const selectedLayout = layouts.find(l => l.id === selectedDisplayLayoutId) ?? null;
  const isDefaultActive = !selectedDisplayLayoutId;

  return (
    <div className="collapsible-section">
      <button className="collapsible-header" onClick={onToggle}>
        <div className="collapsible-header-left">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="collapsible-title">Guest Display</span>
        </div>
        <span className={`collapsible-badge ${isDefaultActive ? 'badge-yellow' : ''}`}>
          {selectedLayout ? selectedLayout.name : 'Default'}
        </span>
      </button>

      {expanded && (
        <div className="collapsible-content">
          <div className="display-layout-section-list">
            {/* None option */}
            <button
              className={`display-layout-section-item ${!selectedDisplayLayoutId ? 'active' : ''}`}
              onClick={() => onSelectLayout(null)}
            >
              <div className="display-layout-section-thumb display-layout-section-thumb--none">
                <Monitor size={16} />
              </div>
              <div className="display-layout-section-info">
                <span className="display-layout-section-name">Default</span>
                <span className="display-layout-section-desc">QR + collage side by side</span>
              </div>
            </button>

            {layouts.map(layout => (
              <button
                key={layout.id}
                className={`display-layout-section-item ${selectedDisplayLayoutId === layout.id ? 'active' : ''}`}
                onClick={() => onSelectLayout(layout.id)}
              >
                <div className="display-layout-section-thumb">
                  {layout.thumbnail ? (
                    <img
                      src={layout.thumbnail.startsWith('asset://')
                        ? convertFileSrc(layout.thumbnail.replace('asset://', ''))
                        : layout.thumbnail}
                      alt={layout.name}
                    />
                  ) : (
                    <Monitor size={16} />
                  )}
                </div>
                <div className="display-layout-section-info">
                  <span className="display-layout-section-name">{layout.name}</span>
                  {layout.isDefault && (
                    <span className="display-layout-section-badge">Default</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { ChevronDown, ChevronRight, Check, Layers } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { CustomSet } from '../../../../types/customSet';

interface CustomSetsSectionProps {
  expanded: boolean;
  onToggle: () => void;
  customSets: CustomSet[];
  loadingSets: boolean;
  selectedCustomSetId: string | null;
  expandedSetIds: Set<string>;
  onToggleSetExpanded: (setId: string) => void;
  onLoadSet: (set: CustomSet) => void;
}

export function CustomSetsSection({
  expanded,
  onToggle,
  customSets,
  loadingSets,
  selectedCustomSetId,
  expandedSetIds,
  onToggleSetExpanded,
  onLoadSet,
}: CustomSetsSectionProps) {
  return (
    <div className="collapsible-section">
      <button
        className="collapsible-header"
        onClick={onToggle}
      >
        <div className="collapsible-header-left">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="collapsible-title">Select Set</span>
        </div>
        {selectedCustomSetId ? (
          <span className="collapsible-badge">
            {customSets.find(s => s.id === selectedCustomSetId)?.name}
          </span>
        ) : (
          <span className="collapsible-badge badge-empty">Not Set</span>
        )}
      </button>
      {expanded && (
        <div className="collapsible-content">
          {loadingSets ? (
            <div className="custom-sets-loading">Loading sets...</div>
          ) : customSets.length === 0 ? (
            <div className="custom-sets-empty-state">
              <p>No custom sets found.</p>
              <p className="custom-sets-hint">Create sets in Collage Creator to use them here.</p>
            </div>
          ) : (
            <div className="custom-set-list">
              {customSets.map((set) => (
                <div
                  key={set.id}
                  className={`custom-set-item ${selectedCustomSetId === set.id ? 'selected' : ''} ${expandedSetIds.has(set.id) ? 'expanded' : ''}`}
                >
                  <button
                    className="custom-set-item-header"
                    onClick={() => onToggleSetExpanded(set.id)}
                  >
                    <div className="custom-set-item-left">
                      {expandedSetIds.has(set.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span className="custom-set-item-name">{set.name}</span>
                    </div>
                    <div className="custom-set-item-right">
                      <span className="custom-set-zones-badge">{set.frame.zones.length} zones</span>
                      {selectedCustomSetId === set.id && (
                        <div className="custom-set-check">
                          <Check size={12} />
                        </div>
                      )}
                    </div>
                  </button>
                  {expandedSetIds.has(set.id) && (
                    <div className="custom-set-item-details">
                      <div className="custom-set-preview-area">
                        {set.thumbnail ? (
                          <img src={convertFileSrc(set.thumbnail.replace('asset://', ''))} alt={set.name} />
                        ) : (
                          <div className="custom-set-no-preview">
                            <Layers size={24} />
                            <span>No preview</span>
                          </div>
                        )}
                      </div>
                      <div className="custom-set-info">
                        <div className="custom-set-detail-row">
                          <span className="detail-label">Canvas</span>
                          <span className="detail-value">{set.canvasSize.width} × {set.canvasSize.height}</span>
                        </div>
                        <div className="custom-set-detail-row">
                          <span className="detail-label">Frame</span>
                          <span className="detail-value">{set.frame.name}</span>
                        </div>
                        {set.description && (
                          <div className="custom-set-detail-row">
                            <span className="detail-label">Note</span>
                            <span className="detail-value">{set.description}</span>
                          </div>
                        )}
                        <button
                          className="custom-set-use-btn"
                          onClick={() => onLoadSet(set)}
                        >
                          {selectedCustomSetId === set.id ? 'Selected' : 'Use This Set'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

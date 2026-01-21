import { useState, useEffect } from 'react';
import { useCollage } from '../../contexts/CollageContext';
import { LayerPosition } from '../../types/overlay';
import { LayerSection } from './LayerSection';
import { OverlayPropertiesPanel } from './OverlayPropertiesPanel';
import { ImportOverlaysModal } from '../Modals/ImportOverlaysModal';
import './LayersSidebar.css';

export function LayersSidebar() {
  const {
    overlays,
    selectedOverlayId,
    setSelectedOverlayId,
    deleteOverlay,
    duplicateOverlay,
    toggleOverlayVisibility,
    moveOverlayLayer,
    addOverlay,
  } = useCollage();

  const [showImportModal, setShowImportModal] = useState(false);

  // Keyboard shortcuts for overlay management
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if an overlay is selected
      if (!selectedOverlayId) return;

      // Delete key - remove selected overlay
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteOverlay(selectedOverlayId);
      }

      // Ctrl+D - duplicate
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        duplicateOverlay(selectedOverlayId);
      }

      // Ctrl+H - toggle visibility
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault();
        toggleOverlayVisibility(selectedOverlayId);
      }

      // Escape - deselect
      if (e.key === 'Escape') {
        setSelectedOverlayId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedOverlayId, deleteOverlay, duplicateOverlay, toggleOverlayVisibility, setSelectedOverlayId]);

  // Split overlays by position
  const belowOverlays = overlays
    .filter(o => o.position === 'below-frames')
    .sort((a, b) => a.layerOrder - b.layerOrder);
  const aboveOverlays = overlays
    .filter(o => o.position === 'above-frames')
    .sort((a, b) => a.layerOrder - b.layerOrder);

  const selectedOverlay = overlays.find(o => o.id === selectedOverlayId);

  return (
    <div className="layers-sidebar">
      <div className="layers-header">
        <h3>Layers</h3>
        <button
          className="import-overlays-btn"
          onClick={() => setShowImportModal(true)}
          title="Import overlay images"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3v10M3 8h10" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Add Overlays
        </button>
      </div>

      <div className="layers-content">
        {/* Above Frames Section */}
        <LayerSection
          title="Above Frames"
          position="above-frames"
          layers={aboveOverlays}
          selectedId={selectedOverlayId}
          onSelect={setSelectedOverlayId}
          onDelete={deleteOverlay}
          onDuplicate={duplicateOverlay}
          onToggleVisibility={toggleOverlayVisibility}
          onMoveLayer={moveOverlayLayer}
        />

        {/* Divider between sections */}
        <div className="layers-divider" />

        {/* Below Frames Section */}
        <LayerSection
          title="Below Frames"
          position="below-frames"
          layers={belowOverlays}
          selectedId={selectedOverlayId}
          onSelect={setSelectedOverlayId}
          onDelete={deleteOverlay}
          onDuplicate={duplicateOverlay}
          onToggleVisibility={toggleOverlayVisibility}
          onMoveLayer={moveOverlayLayer}
        />

        {/* Selected overlay controls */}
        {selectedOverlay && (
          <OverlayPropertiesPanel overlay={selectedOverlay} />
        )}

        {/* Keyboard shortcuts hint */}
        <div className="layers-shortcuts-hint">
          <p>Shortcuts:</p>
          <p>Delete - Remove layer</p>
          <p>Ctrl+D - Duplicate</p>
          <p>Ctrl+H - Toggle visibility</p>
        </div>
      </div>

      {/* Import modal */}
      <ImportOverlaysModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
      />
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useCollage } from '../../../contexts';
import { LayerPosition } from '../../../types/overlay';
import { LayerSection } from './LayerSection';
import { OverlayPropertiesPanel } from '../FrameCreator';
import { ImportOverlaysModal } from '../../Modals';
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
    setOpenFloatingPanel,
  } = useCollage();

  const [showImportModal, setShowImportModal] = useState(false);

  const handleAddOverlaysClick = () => {
    setOpenFloatingPanel(null);
    setShowImportModal(true);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedOverlayId) return;

      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;

      if (e.key === 'Escape') {
        if (isInput) {
          (target as HTMLInputElement).blur();
        } else {
          setSelectedOverlayId(null);
        }
        return;
      }

      if (isInput) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteOverlay(selectedOverlayId);
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        duplicateOverlay(selectedOverlayId);
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault();
        toggleOverlayVisibility(selectedOverlayId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedOverlayId, deleteOverlay, duplicateOverlay, toggleOverlayVisibility, setSelectedOverlayId]);

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
          className="layers-add-btn"
          onClick={handleAddOverlaysClick}
          title="Import overlay images"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M7 2v10M2 7h10" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Add Overlays
        </button>
      </div>

      <div className="layers-content">
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

        <div className="layers-divider" />

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

        {selectedOverlay && (
          <OverlayPropertiesPanel overlay={selectedOverlay} />
        )}

        <div className="frame-shortcuts-hint layers-shortcuts">
          <p>Shortcuts:</p>
          <p>Del - Remove layer</p>
          <p>Ctrl+D - Duplicate</p>
          <p>Ctrl+H - Toggle visibility</p>
          <p>Esc - Deselect layer</p>
        </div>
      </div>

      <ImportOverlaysModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
      />
    </div>
  );
}

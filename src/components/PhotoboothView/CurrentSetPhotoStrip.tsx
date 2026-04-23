import { ChevronRight, Image as ImageIcon, Check, FileCheck, SquareCheck, SquareX, Keyboard } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import KeyboardShortcutsModal from "./KeyboardShortcutsModal";
import "./CurrentSetPhotoStrip.css";

interface CurrentSetPhoto {
  id: string;
  thumbnailUrl: string;
  fullUrl?: string;
  timestamp: string;
}

interface CurrentSetPhotoStripProps {
  currentSetPhotos: CurrentSetPhoto[];
  selectedPhotos: string[];
  setName: string | null;
  workingFolder: string | null;
  frameName: string | null;
  requiredPhotos: number;
  onPhotoSelect: (photoId: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onNextSession: () => void;
  onFinalize: () => void;
  onResizeDragStart?: (e: React.MouseEvent) => void;
  isResizing?: boolean;
}

export default memo(function CurrentSetPhotoStrip({
  currentSetPhotos,
  selectedPhotos,
  setName,
  onResizeDragStart,
  isResizing,
  workingFolder,
  frameName,
  requiredPhotos,
  onPhotoSelect,
  onSelectAll,
  onClearAll,
  onNextSession,
  onFinalize,
}: CurrentSetPhotoStripProps) {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const photosContainerRef = useRef<HTMLDivElement>(null);

  // Handle scroll wheel for horizontal scrolling
  useEffect(() => {
    const container = photosContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // Convert vertical scroll to horizontal scroll
      if (e.deltaY !== 0) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [currentSetPhotos.length]);

  return (
    <div className="current-set-strip">
      <div className="current-set-strip-header">
        <div className="current-set-name-section">
          <span className="current-set-name">{setName ?? 'No session'}</span>
          <span className="current-set-frame-name">{frameName ?? 'No set'}</span>
        </div>
        {onResizeDragStart && (
          <div
            className={`strip-drag-handle${isResizing ? ' is-dragging' : ''}`}
            onMouseDown={onResizeDragStart}
          />
        )}
        <span className="current-set-count">{selectedPhotos.length} / {requiredPhotos} photos</span>
      </div>
      <div className="current-set-body">
        <div className="current-set-photos-column">
          <div className="current-set-photos" ref={photosContainerRef}>
          {currentSetPhotos.length === 0 ? (
            <div className="current-set-empty">
              <ImageIcon size={32} />
              <span>No photos yet - capture photos to see them here</span>
            </div>
          ) : (
              // Display photos in reverse order (newest first) to match guest display
            [...currentSetPhotos].reverse().map((photo, idx) => {
              // Calculate frame number (newest photo gets highest number)
              const frameNumber = currentSetPhotos.length - idx;
              return (
                <div
                  key={photo.id}
                  className={`current-set-photo ${selectedPhotos.includes(photo.id) ? 'selected' : ''}`}
                  onClick={() => onPhotoSelect(photo.id)}
                >
                  <div className="current-set-photo-inner">
                    <img
                      src={photo.thumbnailUrl}
                      alt={`Photo ${frameNumber}`}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <span className="current-set-photo-number">{frameNumber}</span>
                  {selectedPhotos.includes(photo.id) && (
                    <div className="photo-selected-check">
                      <Check size={14} />
                    </div>
                  )}
                </div>
              );
            })
          )}
          </div>
        </div>{/* current-set-photos-column */}
      </div>
      <div className="current-set-photos-footer">
        <div className="selection-control-group">
          <button
            className="selection-control-btn select-all-btn"
            onClick={onSelectAll}
            disabled={currentSetPhotos.length === 0 || currentSetPhotos.length !== requiredPhotos}
            title={currentSetPhotos.length !== requiredPhotos ? `Need exactly ${requiredPhotos} photos to select all` : "Select all photos"}
          >
            <SquareCheck size={15} />
          </button>
          <button
            className="selection-control-btn clear-selection-btn"
            onClick={onClearAll}
            disabled={selectedPhotos.length === 0}
            title="Clear selection"
          >
            <SquareX size={15} />
          </button>
        </div>
        <div className="footer-divider" />
        <div className="footer-selected-photos">
          {selectedPhotos.length === 0 ? (
            <span className="footer-selected-label">No photos selected</span>
          ) : (
            <>
              <span className="footer-selected-label">Selected:</span>
              <div className="footer-selected-chips">
                {selectedPhotos.map((photoId, index) => {
                  const photo = currentSetPhotos.find(p => p.id === photoId);
                  const frameNumber = photo ? currentSetPhotos.indexOf(photo) + 1 : index + 1;
                  return (
                    <span key={photoId} className="footer-selected-chip">#{frameNumber}</span>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div className="footer-shortcuts-hint">
          <span className="shortcuts-key">Space</span>
          <span className="shortcuts-label">Capture</span>
          <span className="shortcuts-key">A/H</span>
          <span className="shortcuts-label">Auto / Hold</span>
          <span className="shortcuts-key">↑/↓</span>
          <span className="shortcuts-label">Interval +/-</span>
        </div>
        <button 
          className="shortcuts-modal-trigger"
          onClick={() => setShowShortcuts(true)}
          title="View all keyboard shortcuts"
        >
          <Keyboard size={14} />
        </button>
      </div>
      
      <KeyboardShortcutsModal 
        isOpen={showShortcuts} 
        onClose={() => setShowShortcuts(false)} 
      />

      <div className="current-set-side-buttons">
        <button
          className="next-session-side-btn"
          onClick={onNextSession}
          disabled={!workingFolder || currentSetPhotos.length === 0}
          title="Create and switch to next session"
        >
          <FileCheck size={16} />
          <span>Finalize</span>
        </button>
        <button
          className="finalize-session-btn"
          onClick={onFinalize}
          disabled={!workingFolder || requiredPhotos === 0 || selectedPhotos.length !== requiredPhotos}
          title={requiredPhotos === 0 ? "Select a set first" : "View finalize page"}
        >
          <ChevronRight size={16} />
          <span>Next</span>
        </button>
      </div>
    </div>
  );
});

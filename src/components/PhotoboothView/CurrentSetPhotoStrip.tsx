import { ChevronRight, Image as ImageIcon, Check, FileCheck } from "lucide-react";
import { memo, useEffect, useRef } from "react";

interface CurrentSetPhoto {
  id: string;
  thumbnailUrl: string;
  fullUrl?: string;
  timestamp: string;
}

interface CurrentSetPhotoStripProps {
  currentSetPhotos: CurrentSetPhoto[];
  selectedPhotos: Set<string>;
  setName: string | null;
  workingFolder: string | null;
  frameName: string | null;
  requiredPhotos: number;
  onPhotoSelect: (photoId: string) => void;
  onNextSession: () => void;
  onFinalize: () => void;
}

export default memo(function CurrentSetPhotoStrip({
  currentSetPhotos,
  selectedPhotos,
  setName,
  workingFolder,
  frameName,
  requiredPhotos,
  onPhotoSelect,
  onNextSession,
  onFinalize,
}: CurrentSetPhotoStripProps) {
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
        <span className="current-set-count">{selectedPhotos.size} / {requiredPhotos} photos</span>
      </div>
      <div className="current-set-body">
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
                  className={`current-set-photo ${selectedPhotos.has(photo.id) ? 'selected' : ''}`}
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
                  {selectedPhotos.has(photo.id) && (
                    <div className="photo-selected-check">
                      <Check size={14} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
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
            disabled={!workingFolder || requiredPhotos === 0 || selectedPhotos.size !== requiredPhotos}
            title={requiredPhotos === 0 ? "Select a set first" : "View finalize page"}
          >
            <ChevronRight size={16} />
            <span>Next</span>
          </button>
        </div>
      </div>
    </div>
  );
});

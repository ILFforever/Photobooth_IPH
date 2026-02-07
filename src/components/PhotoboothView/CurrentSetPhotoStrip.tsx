import { ChevronRight, Image as ImageIcon, Check } from "lucide-react";

interface CurrentSetPhoto {
  id: string;
  thumbnailUrl: string;
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
}

export default function CurrentSetPhotoStrip({
  currentSetPhotos,
  selectedPhotos,
  setName,
  workingFolder,
  frameName,
  requiredPhotos,
  onPhotoSelect,
  onNextSession,
}: CurrentSetPhotoStripProps) {
  return (
    <div className="current-set-strip">
      <div className="current-set-strip-header">
        <div className="current-set-name-section">
          <span className="current-set-name">{setName ?? 'No session'}</span>
          {frameName && (
            <span className="current-set-frame-name">{frameName}</span>
          )}
        </div>
        <span className="current-set-count">{currentSetPhotos.length} / {requiredPhotos} photos</span>
      </div>
      <div className="current-set-body">
        <div className="current-set-photos">
          {currentSetPhotos.length === 0 ? (
            <div className="current-set-empty">
              <ImageIcon size={32} />
              <span>No photos yet - capture photos to see them here</span>
            </div>
          ) : (
            currentSetPhotos.map((photo, idx) => (
              <div
                key={photo.id}
                className={`current-set-photo ${selectedPhotos.has(photo.id) ? 'selected' : ''}`}
                onClick={() => onPhotoSelect(photo.id)}
              >
                <div className="current-set-photo-inner">
                  <img src={photo.thumbnailUrl} alt={`Photo ${idx + 1}`} />
                </div>
                <span className="current-set-photo-number">{idx + 1}</span>
                {selectedPhotos.has(photo.id) && (
                  <div className="photo-selected-check">
                    <Check size={14} />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        <button
          className="next-session-side-btn"
          onClick={onNextSession}
          disabled={!workingFolder}
          title="Create and switch to next session"
        >
          <ChevronRight size={16} />
          <span>Next</span>
        </button>
      </div>
    </div>
  );
}

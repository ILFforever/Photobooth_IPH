import { Layers, Camera, Image as ImageIcon, Grid3x3 } from "lucide-react";
import { mdiFlashTriangleOutline } from '@mdi/js';
import Icon from '@mdi/react';
import { useEffect, useRef } from "react";

type DisplayMode = 'single' | 'center' | 'canvas';

interface CurrentSetPhoto {
  id: string;
  thumbnailUrl: string;
  timestamp: string;
}

interface DisplayContentProps {
  displayMode: DisplayMode;
  currentSetPhotos: CurrentSetPhoto[];
  selectedPhotoIndex: number | null;
  onPhotoDoubleClick?: (index: number) => void;
  onExitFullscreen?: () => void;
  onNavClick?: (direction: 'prev' | 'next') => void;
  // Optional features for main workspace
  showGridOverlay?: boolean;
  showRecentPhotos?: boolean;
  showBackButton?: boolean;
  // Live view stream
  liveViewStream?: MediaStream | null;
}

export default function DisplayContent({
  displayMode,
  currentSetPhotos,
  selectedPhotoIndex,
  onPhotoDoubleClick,
  onExitFullscreen,
  onNavClick,
  showGridOverlay = false,
  showRecentPhotos = false,
  showBackButton = false,
  liveViewStream = null
}: DisplayContentProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Attach stream to video element when stream changes
  useEffect(() => {
    if (liveViewStream && videoRef.current) {
      videoRef.current.srcObject = liveViewStream;
    }
  }, [liveViewStream]);

  // Render display content based on mode
  switch (displayMode) {
    case 'single':
      return (
        <div className="single-display">
          {liveViewStream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="single-liveview-video"
            />
          ) : (
            <div className="single-photo-content">
              <Icon path={mdiFlashTriangleOutline} size={3} />
              <span className="single-photo-label">No live view connected</span>
            </div>
          )}
        </div>
      );

    case 'center':
      return (
        <div className="center-display">
          {/* Main live view */}
          <div className="center-main">
            {liveViewStream ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="center-liveview-video"
              />
            ) : (
              <div className="center-main-content">
                <Camera size={48} strokeWidth={1.5} />
                <span className="center-label">Live View</span>
              </div>
            )}
            {/* Grid overlay within center-main */}
            {(showGridOverlay || liveViewStream) && (
              <div className="grid-overlay center-grid">
                <div className="grid-line grid-h-1"></div>
                <div className="grid-line grid-h-2"></div>
                <div className="grid-line grid-v-1"></div>
                <div className="grid-line grid-v-2"></div>
              </div>
            )}
          </div>
          {/* Recent photos strip */}
          {showRecentPhotos && (
            <div className="center-recent">
              {Array.from({ length: 5 }).map((_, idx) => (
                <div key={idx} className="center-recent-photo">
                  <ImageIcon size={20} />
                </div>
              ))}
            </div>
          )}
        </div>
      );

    case 'canvas':
      // Show single photo if one is selected
      if (selectedPhotoIndex !== null) {
        const currentPhoto = currentSetPhotos[selectedPhotoIndex];
        const totalPhotos = currentSetPhotos.length || 6;

        return (
          <div className="single-photo-display" onDoubleClick={onExitFullscreen}>
            <div className="single-photo-container">
              {showBackButton && (
                <button
                  className="back-to-grid-btn"
                  onClick={onExitFullscreen}
                  title="Back to grid (double-click or press ESC)"
                >
                  <Grid3x3 size={20} />
                  <span>Back to Grid</span>
                </button>
              )}
              <div className="fullscreen-photo-nav">
                <button
                  className="nav-arrow-btn nav-prev"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavClick?.('prev');
                  }}
                  disabled={selectedPhotoIndex === 0}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <div className="single-photo-content">
                  {currentPhoto ? (
                    <img src={currentPhoto.thumbnailUrl} alt={`Photo ${selectedPhotoIndex + 1}`} className="fullscreen-photo-img" />
                  ) : (
                    <>
                      <Layers size={64} />
                      <span className="single-photo-label">Photo {selectedPhotoIndex + 1}</span>
                    </>
                  )}
                </div>
                <button
                  className="nav-arrow-btn nav-next"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavClick?.('next');
                  }}
                  disabled={selectedPhotoIndex >= totalPhotos - 1}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              </div>
              <div className="fullscreen-counter">
                {selectedPhotoIndex + 1} / {totalPhotos}
              </div>
            </div>
          </div>
        );
      }

      // Show grid
      const displayPhotos: Array<{ id?: string; thumbnailUrl?: string } | null> =
        currentSetPhotos.length > 0 ? currentSetPhotos : Array.from({ length: 6 }, () => null);

      return (
        <div className={`grid-display ${currentSetPhotos.length > 6 ? 'grid-scrollable' : ''}`}>
          {displayPhotos.map((photo, idx) => {
            const isRealPhoto = photo !== null && photo.id && photo.thumbnailUrl;
            return (
              <div
                key={photo?.id || `placeholder-${idx}`}
                className="grid-photo"
                onDoubleClick={() => onPhotoDoubleClick?.(idx)}
              >
                {isRealPhoto ? (
                  <img src={photo.thumbnailUrl} alt={`Photo ${idx + 1}`} className="grid-photo-img" />
                ) : (
                  <Layers size={24} />
                )}
              </div>
            );
          })}
        </div>
      );

    default:
      return null;
  }
}

import { Layers, Camera, Image as ImageIcon, Grid3x3, ArrowLeft } from "lucide-react";
import { mdiFlashTriangleOutline } from '@mdi/js';
import Icon from '@mdi/react';
import { useCallback, useRef } from "react";

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
  showGridOverlay?: boolean;
  showRecentPhotos?: boolean;
  showBackButton?: boolean;
  liveViewStream?: MediaStream | null;
  hdmiStreamUrl?: string | null;
  showCapturePreview?: boolean;
  capturedPhotoUrl?: string | null;
  onCapturePreviewLoad?: () => void; // Called when the preview image has finished loading
  // Center mode photo browsing
  centerBrowseIndex?: number | null;
  onCenterPhotoClick?: (index: number) => void;
  onCenterBack?: () => void;
  onCenterNavClick?: (direction: 'prev' | 'next') => void;
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
  liveViewStream = null,
  hdmiStreamUrl = null,
  showCapturePreview = false,
  capturedPhotoUrl = null,
  onCapturePreviewLoad,
  centerBrowseIndex = null,
  onCenterPhotoClick,
  onCenterBack,
  onCenterNavClick,
}: DisplayContentProps) {
  // Use a callback ref so srcObject is attached whenever the <video> DOM node
  // mounts (including after a display-mode switch that destroys/recreates it).
  const streamRef = useRef<MediaStream | null>(liveViewStream);
  streamRef.current = liveViewStream;

  const videoCallbackRef = useCallback((node: HTMLVideoElement | null) => {
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
    }
  }, []);


  // Shared video element builder to avoid duplication
  const renderVideo = (className: string) => (
    <video
      ref={videoCallbackRef}
      autoPlay
      playsInline
      muted
      className={className}
    />
  );

  // Shared HDMI img element builder
  const renderHdmiImg = (className: string) => (
    <img
      src={hdmiStreamUrl!}
      className={className}
      alt="HDMI Live View"
    />
  );

  const hasLiveView = !!(liveViewStream || hdmiStreamUrl);

  // Render the appropriate live view element
  const renderLiveView = (className: string) => {
    // Show capture preview instead of live view when preview is active
    if (showCapturePreview && capturedPhotoUrl) {
      return (
        <img
          src={capturedPhotoUrl}
          alt="Captured preview"
          className="capture-preview-in-place"
          onLoad={() => onCapturePreviewLoad?.()}
        />
      );
    }
    if (hdmiStreamUrl) return renderHdmiImg(className);
    if (liveViewStream) return renderVideo(className);
    return null;
  };

  // Full capture preview overlay (for fullscreen mode - e.g., when browsing photos)
  const capturePreviewOverlay = showCapturePreview && capturedPhotoUrl ? (
    <div className="capture-preview-overlay">
      <img src={capturedPhotoUrl} alt="Captured preview" className="capture-preview-image" onLoad={() => onCapturePreviewLoad?.()} />
    </div>
  ) : null;

  // Wrap content with preview overlay (only for fullscreen/browse mode)
  const withPreview = (content: React.ReactNode) => (
    <>
      {content}
      {capturePreviewOverlay}
    </>
  );

  switch (displayMode) {
    case 'single':
      return (
        <div className="single-display">
          {hasLiveView || (showCapturePreview && capturedPhotoUrl) ? (
            renderLiveView("single-liveview-video")
          ) : (
            <div className="single-photo-content">
              <Icon path={mdiFlashTriangleOutline} size={3} />
              <span className="single-photo-label">No live view connected</span>
            </div>
          )}
        </div>
      );

    case 'center':
      // If browsing a photo, show fullscreen view with back button
      if (centerBrowseIndex !== null && currentSetPhotos[centerBrowseIndex]) {
        const browsePhoto = currentSetPhotos[centerBrowseIndex];
        return withPreview(
          <div className="single-photo-display">
            <div className="single-photo-container">
              <button
                className="back-to-grid-btn"
                onClick={onCenterBack}
                title="Back to live view"
              >
                <ArrowLeft size={20} />
                <span>Back</span>
              </button>
              <div className="fullscreen-photo-nav">
                <button
                  className="nav-arrow-btn nav-prev"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCenterNavClick?.('prev');
                  }}
                  disabled={centerBrowseIndex === 0}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <div className="single-photo-content">
                  <img src={browsePhoto.thumbnailUrl} alt={`Photo ${centerBrowseIndex + 1}`} className="fullscreen-photo-img" />
                </div>
                <button
                  className="nav-arrow-btn nav-next"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCenterNavClick?.('next');
                  }}
                  disabled={centerBrowseIndex >= currentSetPhotos.length - 1}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              </div>
              <div className="fullscreen-counter">
                {centerBrowseIndex + 1} / {currentSetPhotos.length}
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="center-display">
          <div className="center-main">
            {hasLiveView || (showCapturePreview && capturedPhotoUrl) ? (
              renderLiveView("center-liveview-video")
            ) : (
              <div className="center-main-content">
                <Camera size={48} strokeWidth={1.5} />
                <span className="center-label">Live View</span>
              </div>
            )}
          </div>
          {showRecentPhotos && (
            <div className="center-recent">
              {Array.from({ length: 5 }).map((_, idx) => {
                // Show 5 most recent photos, newest first
                const recentPhotos = [...currentSetPhotos].reverse().slice(0, 5);
                const photo = recentPhotos[idx];
                return (
                  <div
                    key={photo?.id || `skeleton-${idx}`}
                    className={`center-recent-photo ${photo ? 'has-photo' : 'skeleton'}`}
                    onClick={() => {
                      if (photo) {
                        // Map back to original index in currentSetPhotos
                        const actualIndex = currentSetPhotos.length - 1 - idx;
                        onCenterPhotoClick?.(actualIndex);
                      }
                    }}
                    style={{ cursor: photo ? 'pointer' : 'default' }}
                  >
                    {photo ? (
                      <img
                        src={photo.thumbnailUrl}
                        alt={`Recent ${idx + 1}`}
                        className="center-recent-img"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <ImageIcon size={20} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );

    case 'canvas': {
      // Reversed array used throughout canvas mode (newest first)
      const canvasPhotos = [...currentSetPhotos].reverse();

      if (selectedPhotoIndex !== null) {
        const currentPhoto = canvasPhotos[selectedPhotoIndex];
        const totalPhotos = canvasPhotos.length || 6;

        return withPreview(
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

      // Show grid - newest first, pad to fill last row (3 columns, min 6 slots)
      const cols = 3;
      const minSlots = 6;
      const paddedPhotos: Array<{ id?: string; thumbnailUrl?: string } | null> = [...canvasPhotos];
      const target = Math.max(minSlots, Math.ceil(paddedPhotos.length / cols) * cols);
      while (paddedPhotos.length < target) {
        paddedPhotos.push(null);
      }
      const displayPhotos = paddedPhotos;

      return withPreview(
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
                  <img
                    src={photo.thumbnailUrl}
                    alt={`Photo ${idx + 1}`}
                    className="grid-photo-img"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <ImageIcon size={24} />
                )}
              </div>
            );
          })}
        </div>
      );
    }

    default:
      return null;
  }
}

import { Layers, Camera, Image as ImageIcon, Grid3x3, ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import "./DisplayContent.css";
import { mdiFlashTriangleOutline } from '@mdi/js';
import Icon from '@mdi/react';
import { memo, useCallback, useRef, useState } from "react";

type DisplayMode = 'single' | 'center' | 'canvas' | 'finalize';

interface CurrentSetPhoto {
  id: string;
  thumbnailUrl: string;
  fullUrl?: string;
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
  // Finalize mode data
  finalizeImageUrl?: string | null;
  finalizeQrData?: string | null;
  // Center mode photo browsing
  centerBrowseIndex?: number | null;
  onCenterPhotoClick?: (index: number) => void;
  onCenterBack?: () => void;
  onCenterNavClick?: (direction: 'prev' | 'next') => void;
}

export default memo(function DisplayContent({
  displayMode,
  currentSetPhotos,
  selectedPhotoIndex,
  onPhotoDoubleClick,
  onExitFullscreen,
  onNavClick,
  showRecentPhotos = false,
  showBackButton = false,
  liveViewStream = null,
  hdmiStreamUrl = null,
  showCapturePreview = false,
  capturedPhotoUrl = null,
  onCapturePreviewLoad,
  finalizeImageUrl = null,
  finalizeQrData = null,
  centerBrowseIndex = null,
  onCenterPhotoClick,
  onCenterBack,
  onCenterNavClick,
}: DisplayContentProps) {
  // Pagination state for canvas mode
  const [currentPage, setCurrentPage] = useState(0);
  const PHOTOS_PER_PAGE = 9;

  // Reset to first page when photos change
  const prevPhotoCountRef = useRef(currentSetPhotos.length);
  if (prevPhotoCountRef.current !== currentSetPhotos.length) {
    prevPhotoCountRef.current = currentSetPhotos.length;
    setCurrentPage(0);
  }

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
                    onCenterNavClick?.('next');
                  }}
                  disabled={centerBrowseIndex >= currentSetPhotos.length - 1}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <div className="single-photo-content">
                  <img src={browsePhoto.fullUrl || browsePhoto.thumbnailUrl} alt={`Photo ${centerBrowseIndex + 1}`} className="fullscreen-photo-img" />
                </div>
                <button
                  className="nav-arrow-btn nav-next"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCenterNavClick?.('prev');
                  }}
                  disabled={centerBrowseIndex === 0}
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
                        src={photo.fullUrl || photo.thumbnailUrl}
                        alt={`Recent ${idx + 1}`}
                        className="center-recent-img"
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
                    <img src={currentPhoto.fullUrl || currentPhoto.thumbnailUrl} alt={`Photo ${selectedPhotoIndex + 1}`} className="fullscreen-photo-img" />
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

      // Pagination: 9 photos per page (3x3 grid)
      const totalPages = Math.ceil(canvasPhotos.length / PHOTOS_PER_PAGE) || 1;

      // Get photos for current page
      const startIndex = currentPage * PHOTOS_PER_PAGE;
      const pagePhotos = canvasPhotos.slice(startIndex, startIndex + PHOTOS_PER_PAGE);

      // Pad to fill 3x3 grid
      const paddedPhotos: Array<{ id?: string; thumbnailUrl?: string; fullUrl?: string } | null> = [...pagePhotos];
      while (paddedPhotos.length < PHOTOS_PER_PAGE) {
        paddedPhotos.push(null);
      }

      // Navigate to next/prev page
      const goToNextPage = () => setCurrentPage(prev => Math.min(prev + 1, totalPages - 1));
      const goToPrevPage = () => setCurrentPage(prev => Math.max(prev - 1, 0));

      return withPreview(
        <div className="grid-display-container">
          <div className="grid-display grid-3x3">
            {paddedPhotos.map((photo, idx) => {
              const isRealPhoto = photo !== null && photo.id && (photo.thumbnailUrl || photo.fullUrl);
              const imgSrc = isRealPhoto && photo ? (photo.fullUrl || photo.thumbnailUrl) : '';
              const globalIndex = startIndex + idx; // Index in the full canvasPhotos array
              // Calculate actual frame number (photos are reversed in canvas mode)
              // globalIndex 0 should show frame number equal to total photos (newest first)
              const frameNumber = currentSetPhotos.length - globalIndex;
              return (
                <div
                  key={photo?.id || `placeholder-${idx}`}
                  className="grid-photo"
                  onDoubleClick={() => {
                    if (isRealPhoto) {
                      onPhotoDoubleClick?.(globalIndex);
                    }
                  }}
                >
                  {isRealPhoto ? (
                    <>
                      <img
                        src={imgSrc}
                        alt={`Photo ${frameNumber}`}
                        className="grid-photo-img"
                      />
                      <span className="grid-photo-number">{frameNumber}</span>
                    </>
                  ) : (
                    <ImageIcon size={24} />
                  )}
                </div>
              );
            })}
          </div>
          {totalPages > 1 && (
            <div className="pagination-controls">
              <button
                className="pagination-btn pagination-prev"
                onClick={goToPrevPage}
                disabled={currentPage === 0}
              >
                <ChevronLeft size={20} />
              </button>
              <span className="pagination-indicator">
                Page {currentPage + 1} / {totalPages}
              </span>
              <button
                className="pagination-btn pagination-next"
                onClick={goToNextPage}
                disabled={currentPage === totalPages - 1}
              >
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </div>
      );
    }

    case 'finalize': {
      if (!finalizeImageUrl) {
        return (
          <div className="single-display">
            <div className="single-photo-content">
              <ImageIcon size={48} />
              <span className="single-photo-label">No collage to display</span>
            </div>
          </div>
        );
      }

      if (finalizeQrData) {
        return (
          <div className="finalize-display">
            <div className="finalize-collage-section">
              <img
                src={finalizeImageUrl}
                alt="Collage"
                className="finalize-collage-img"
              />
            </div>
            <div className="finalize-divider" />
            <div className="finalize-qr-section">
              <div className="finalize-qr-frame">
                <img
                  src={`data:image/png;base64,${finalizeQrData}`}
                  alt="QR Code"
                  className="finalize-qr-img"
                />
              </div>
              <span className="finalize-qr-label">SCAN FOR PHOTOS</span>
              <span className="finalize-qr-thankyou">Thank you for using IPH Photobooth!</span>
            </div>
          </div>
        );
      }

      return (
        <div className="finalize-display finalize-collage-only">
          <img
            src={finalizeImageUrl}
            alt="Collage"
            className="finalize-collage-img"
          />
        </div>
      );
    }

    default:
      return null;
  }
})

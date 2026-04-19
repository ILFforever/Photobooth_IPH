import { Layers, Camera, Image as ImageIcon, Grid3x3, ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import "./DisplayContent.css";
import { mdiPowerPlugOff } from '@mdi/js';
import Icon from '@mdi/react';
import { memo, useCallback, useRef, useState, useEffect } from "react";
import { convertFileSrc } from '@tauri-apps/api/core';
import QRCode from 'qrcode';
import { DisplayLayout, DisplayElement, FrameShape } from '../../types/displayLayout';

function getFrameBorderRadius(shape: FrameShape, borderRadius?: number): string {
  switch (shape) {
    case 'circle':
    case 'ellipse':
      return '50%';
    case 'rounded_rect':
      return `${borderRadius || 12}px`;
    case 'pill':
      return '999px';
    default:
      return '2px';
  }
}

function getFrameClipPath(shape: FrameShape): string | undefined {
  switch (shape) {
    case 'triangle':
      return 'polygon(50% 0%, 0% 100%, 100% 100%)';
    case 'pentagon':
      return 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)';
    case 'hexagon':
      return 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
    case 'octagon':
      return 'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)';
    case 'star':
      return 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)';
    case 'diamond':
      return 'polygon(50% 0%, 78% 50%, 50% 100%, 22% 50%)';
    case 'heart':
      return 'polygon(50% 95%, 65% 75%, 78% 60%, 90% 48%, 97% 35%, 98% 22%, 96% 14%, 93% 8%, 87% 3%, 80% 1%, 76% 1%, 73% 2%, 71% 3%, 69% 4%, 68% 5%, 66% 6%, 64% 7%, 62% 9%, 61% 10%, 59% 12%, 57% 13%, 56% 15%, 53% 17%, 50% 18%, 47% 17%, 44% 15%, 43% 13%, 41% 12%, 39% 10%, 38% 9%, 36% 7%, 34% 6%, 32% 5%, 31% 4%, 29% 3%, 27% 2%, 24% 1%, 20% 1%, 13% 3%, 7% 8%, 4% 14%, 2% 22%, 3% 35%, 10% 48%, 22% 60%, 35% 75%)';
    case 'cross':
      return 'polygon(20% 0%, 80% 0%, 80% 20%, 100% 20%, 100% 80%, 80% 80%, 80% 100%, 20% 100%, 20% 80%, 0% 80%, 0% 20%, 20% 20%)';
    default:
      return undefined;
  }
}

// Module-level cache — mock QR is generated once and reused across all instances
let mockQrPromise: Promise<string> | null = null;
function getMockQrDataUrl(): Promise<string> {
  if (!mockQrPromise) {
    mockQrPromise = QRCode.toDataURL('https://iphphotobooth.com', {
      width: 300,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    });
  }
  return mockQrPromise;
}

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
  onCapturePreviewLoad?: () => void;
  finalizeImageUrl?: string | null;
  finalizeQrData?: string | null;
  centerBrowseIndex?: number | null;
  onCenterPhotoClick?: (index: number) => void;
  onCenterBack?: () => void;
  onCenterNavClick?: (direction: 'prev' | 'next') => void;
  displayLayout?: DisplayLayout | null;
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
  displayLayout = null,
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
              <Icon path={mdiPowerPlugOff } size={3} />
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
                  onDoubleClick={(e) => e.stopPropagation()}
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
                  onDoubleClick={(e) => e.stopPropagation()}
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
                  onDoubleClick={(e) => e.stopPropagation()}
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
                  onDoubleClick={(e) => e.stopPropagation()}
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

      if (displayLayout && displayLayout.elements.length > 0) {
        return (
          <FinalizeLayoutDisplay
            displayLayout={displayLayout}
            finalizeImageUrl={finalizeImageUrl}
            finalizeQrData={finalizeQrData}
          />
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

function FinalizeLayoutDisplay({
  displayLayout,
  finalizeImageUrl,
  finalizeQrData,
}: {
  displayLayout: DisplayLayout;
  finalizeImageUrl: string;
  finalizeQrData: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);

  const canvasW = displayLayout.canvasWidth ?? 1920;
  const canvasH = displayLayout.canvasHeight ?? 1080;

  useEffect(() => {
    const updateFit = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setFitScale(Math.min(rect.width / canvasW, rect.height / canvasH));
    };
    updateFit();
    const observer = new ResizeObserver(updateFit);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [canvasW, canvasH]);

  const scaledW = Math.round(canvasW * fitScale);
  const scaledH = Math.round(canvasH * fitScale);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', animation: 'fadeIn 0.3s ease' }}>
      <div style={{ width: scaledW, height: scaledH, position: 'relative', flexShrink: 0 }}>
        <div
          style={{
            width: canvasW,
            height: canvasH,
            position: 'absolute',
            top: 0,
            left: 0,
            transformOrigin: 'top left',
            transform: `scale(${fitScale})`,
            backgroundColor: displayLayout.backgroundColor,
            backgroundImage: displayLayout.backgroundImage
              ? `url(${displayLayout.backgroundImage.startsWith('asset://') ? convertFileSrc(displayLayout.backgroundImage.replace('asset://', '')) : displayLayout.backgroundImage})`
              : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            overflow: 'hidden',
          }}
        >
          {displayLayout.elements
            .sort((a, b) => a.layerOrder - b.layerOrder)
            .filter(el => el.visible)
            .map(el => (
              <FinalizeElement
                key={el.id}
                element={el}
                finalizeImageUrl={finalizeImageUrl}
                finalizeQrData={finalizeQrData}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

function FinalizeElement({
  element,
  finalizeImageUrl,
  finalizeQrData,
}: {
  element: DisplayElement;
  finalizeImageUrl: string;
  finalizeQrData: string | null;
}) {
  const [mockQrUrl, setMockQrUrl] = useState<string | null>(null);

  useEffect(() => {
    console.log('[FinalizeElement] finalizeQrData:', {
      hasData: !!finalizeQrData,
      length: finalizeQrData?.length || 0,
      elementRole: element.role,
    });
    if (element.role !== 'qr' || finalizeQrData) return;
    console.log('[FinalizeElement] Using mock QR');
    getMockQrDataUrl().then(setMockQrUrl);
  }, [element.role, finalizeQrData]);

  const t = element.transform;

  // Debug logging
  console.log('[FinalizeElement] element.role:', element.role, 'sourcePath:', element.sourcePath, 'textContent:', element.textContent, 'visible:', element.visible);

  // QR codes should never be flipped or use blend modes to ensure they are always scanable
  const isQR = element.role === 'qr';
  const flipH = isQR ? false : t.flipHorizontal;
  const flipV = isQR ? false : t.flipVertical;
  const blendMode = isQR ? 'normal' : element.blendMode;

  const transformStyle = `translate(${t.x}px, ${t.y}px) rotate(${t.rotation}deg) scale(${t.scale}) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`;

  const style: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    transformOrigin: 'center center',
    transform: transformStyle,
    opacity: t.opacity,
    mixBlendMode: blendMode as any,
    zIndex: element.layerOrder,
  };

  switch (element.role) {
    case 'collage': {
      const cw = element.collageWidth ?? 480;
      const ch = element.collageHeight ?? 540;
      return (
        <div style={style}>
          <img src={finalizeImageUrl} alt="Collage" draggable={false} style={{ display: 'block', width: cw, height: ch, objectFit: 'fill', pointerEvents: 'none' }} />
        </div>
      );
    }
    case 'qr': {
      const qrSrc = finalizeQrData
        ? `data:image/png;base64,${finalizeQrData}`
        : mockQrUrl ?? null;
      if (!qrSrc) return null;
      return (
        <div style={style}>
          <img src={qrSrc} alt="QR Code" draggable={false} style={{ display: 'block', width: 300, height: 300, pointerEvents: 'none', opacity: finalizeQrData ? 1 : 0.4 }} />
        </div>
      );
    }
    case 'text': {
      // Properly format font family - wrap in quotes if it contains spaces and is not a CSS variable
      const formatFontFamily = (font: string | undefined) => {
        if (!font) return 'inherit';
        if (font.startsWith('var(')) return font;
        // If font name contains spaces, wrap in quotes and add fallbacks
        const quotedFont = font.includes(' ') ? `"${font}"` : font;
        // Add fallback chain: selected font → system sans → sans-serif
        return `${quotedFont}, var(--font-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif`;
      };
      return (
        <div style={{
          ...style,
          fontSize: element.fontSize || 24,
          color: element.fontColor || '#ffffff',
          fontWeight: element.fontWeight || '400',
          fontFamily: formatFontFamily(element.fontFamily),
          whiteSpace: 'nowrap',
          userSelect: 'none',
        }}>
          {element.textContent || ''}
        </div>
      );
    }
    case 'emoji':
      return (
        <div style={{ ...style, fontSize: element.fontSize || 80, userSelect: 'none', lineHeight: 1 }}>
          {element.textContent || '😊'}
        </div>
      );
    case 'logo':
    case 'gif': {
      if (!element.sourcePath) return null;
      const imgSrc = element.sourcePath.startsWith('asset://') ? convertFileSrc(element.sourcePath.replace('asset://', '')) : element.sourcePath;

      const frameShape = element.frameShape || 'none';
      const hasFrame = frameShape !== 'none';

      if (!hasFrame) {
        return (
          <div style={style}>
            <img
              src={imgSrc}
              alt={element.role}
              draggable={false}
              onError={(e) => console.error('[FinalizeElement] FAILED to load', element.role, imgSrc, e)}
              style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
            />
          </div>
        );
      }

      const frameWidth = element.frameWidth || 8;
      const frameColor = element.frameColor || '#ffffff';
      const frameRadius = getFrameBorderRadius(frameShape, element.frameBorderRadius);
      const frameClipPath = getFrameClipPath(frameShape);

      return (
        <div style={style}>
          <div style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <div style={{
              position: 'absolute',
              inset: 0,
              border: `${frameWidth}px solid ${frameColor}`,
              borderRadius: frameRadius,
              clipPath: frameClipPath,
              pointerEvents: 'none',
            }} />
            <div style={{
              width: '100%',
              height: '100%',
              position: 'relative',
              overflow: 'hidden',
              borderRadius: frameRadius,
              clipPath: frameClipPath,
            }}>
              <img
                src={imgSrc}
                alt={element.role}
                draggable={false}
                onError={(e) => console.error('[FinalizeElement] FAILED to load', element.role, imgSrc, e)}
                style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
              />
            </div>
          </div>
        </div>
      );
    }
    case 'shape': {
      const w = element.shapeWidth ?? 200;
      const h = element.shapeHeight ?? 200;
      if (element.shapeType === 'heart') {
        const sw = element.shapeBorderWidth ?? 0;
        return (
          <div style={style}>
            <svg width={w} height={h} viewBox="0 0 100 100" style={{ display: 'block', pointerEvents: 'none' }}>
              <path
                d="M50 80 C20 62, 2 48, 2 30 A24 24 0 0 1 50 22 A24 24 0 0 1 98 30 C98 48, 80 62, 50 80 Z"
                fill={element.shapeFill ?? '#e11d48'}
                stroke={sw > 0 ? (element.shapeBorderColor ?? 'transparent') : 'none'}
                strokeWidth={sw}
              />
            </svg>
          </div>
        );
      }
      const clipPaths: Record<string, string> = {
        triangle:  'polygon(50% 0%, 0% 100%, 100% 100%)',
        diamond:   'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
        star:      'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
        hexagon:   'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)',
        pentagon:  'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)',
        cross:     'polygon(20% 0%, 80% 0%, 80% 20%, 100% 20%, 100% 80%, 80% 80%, 80% 100%, 20% 100%, 20% 80%, 0% 80%, 0% 20%, 20% 20%)',
      };
      return (
        <div style={style}>
          <div style={{
            width: w,
            height: h,
            background: element.shapeFill ?? '#3b82f6',
            border: (element.shapeBorderWidth ?? 0) > 0 ? `${element.shapeBorderWidth}px solid ${element.shapeBorderColor ?? 'transparent'}` : 'none',
            borderRadius: element.shapeType === 'circle' ? '50%' : element.shapeType === 'rounded-rectangle' ? `${element.shapeBorderRadius ?? 24}px` : '0px',
            clipPath: element.shapeType ? clipPaths[element.shapeType] : undefined,
            pointerEvents: 'none',
            boxSizing: 'border-box',
          }} />
        </div>
      );
    }
    default:
      return null;
  }
}
